const path = require("path");
const { chromium } = require("playwright");
const { ensureDir, fileExists } = require("../lib/fs-utils");
const { getAccountPaths } = require("../lib/accounts");
const { BROWSER_VIEWPORT, HEADLESS } = require("../lib/env");
const { attachQrDataUrlSniffer } = require("../lib/qr");
const {
  MATERIALS_DIR,
  VIDEO_POST_URL,
  saveDebugArtifacts,
  fillTitleAndDescription,
  selectSelfDeclaration,
  setScheduleIfNeeded,
  ensureLoggedIn,
  clickPublishButton,
} = require("./utils");

async function uploadVideo(page, videoKey, accountName) {
  const filePath = path.join(MATERIALS_DIR, videoKey);
  if (!(await fileExists(filePath))) {
    throw new Error(`视频文件不存在: ${filePath}`);
  }

  // 视频页面 file input 是隐藏的，用 attached 状态检测
  await page.waitForSelector('input[type="file"][accept*="video"]', { state: 'attached', timeout: 30000 }).catch(() => {});
  const videoInput = page.locator('input[type="file"][accept*="video"]').first();
  if ((await videoInput.count()) > 0) {
    await videoInput.setInputFiles(filePath);
    console.log(`已选择视频文件: ${videoKey}`);
  } else {
    await saveDebugArtifacts(page, accountName, "video-upload-not-found");
    throw new Error("无法触发视频上传");
  }

  console.log("等待视频上传完成...");
  try {
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      const blobImg = document.querySelector('img[src^="blob:"]');
      return video || blobImg;
    }, { timeout: 120000 });
  } catch {}
  await page.waitForTimeout(2000);
}

async function selectFirstAiCover(page) {
  const aiContainer = await page.waitForSelector('[class*="recommendCoverContainer"]', { timeout: 30000 }).catch(() => null);
  if (!aiContainer) {
    console.log("AI封面容器未出现，使用默认第一帧封面");
    return;
  }

  await page.waitForTimeout(3000);
  const aiCoverItems = page.locator('[class*="recommendCoverContainer"] > [class*="recommendCover"]');
  const aiCount = await aiCoverItems.count().catch(() => 0);
  console.log(`AI推荐封面数: ${aiCount}`);

  for (let i = 0; i < aiCount; i += 1) {
    const item = aiCoverItems.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;
    const classAttr = await item.getAttribute("class").catch(() => "");
    if (/isSetting/i.test(classAttr)) continue;
    const imgs = await item.locator("img").count().catch(() => 0);
    if (imgs === 0) continue;

    await item.evaluate((el) => el.click()).catch(() => item.click().catch(() => {}));
    await page.waitForTimeout(1000);
    console.log(`已点击第 ${i + 1} 个AI推荐封面`);
    break;
  }

  const modalConfirm = page.locator('.semi-modal-content button:has-text("确定"), .semi-modal-wrap button:has-text("确定")').first();
  if (await modalConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
    await modalConfirm.click();
    await page.waitForTimeout(1000);
  } else {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function fillProductEditModal(page, productTitle, approvalNumber) {
  const editModal = page.locator('.semi-modal-content').filter({ hasText: '完成编辑' }).first();
  await editModal.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  if (!(await editModal.isVisible().catch(() => false))) {
    console.log("  → 无弹窗，链接可能已直接添加");
    return;
  }

  console.log("  商品编辑弹窗已打开");
  const modalContent = await editModal.evaluate((m) => ({
    text: m.textContent.trim().slice(0, 500),
    inputs: Array.from(m.querySelectorAll('input')).map((i) => ({ ph: i.placeholder, v: i.value })),
    buttons: Array.from(m.querySelectorAll('button, [class*="btn"]')).map((b) => b.textContent.trim().slice(0, 20)).filter(Boolean),
  })).catch(() => null);
  if (modalContent?.inputs?.length) {
    modalContent.inputs.forEach((inp) => console.log(`    [输入框] "${inp.ph}"`));
  }

  async function fillFieldByLabel(labelText, value, placeholderSelector) {
    if (!value) return;

    const directInput = editModal.locator(placeholderSelector).first();
    if (await directInput.isVisible().catch(() => false)) {
      await directInput.fill(value);
      console.log(`  ✓ 已填写${labelText}: ${value}`);
      return;
    }

    const byLabel = editModal.locator(`xpath=.//*[normalize-space()="${labelText}"]/ancestor::*[contains(@class,"semi-form-field")][1]//input`).first();
    if (await byLabel.isVisible().catch(() => false)) {
      await byLabel.fill(value);
      console.log(`  ✓ 已填写${labelText}: ${value}`);
      return;
    }

    const fallbackByText = editModal.locator(`xpath=.//*[contains(normalize-space(),"${labelText}")]/following::input[1]`).first();
    if (await fallbackByText.isVisible().catch(() => false)) {
      await fallbackByText.fill(value);
      console.log(`  ✓ 已填写${labelText}: ${value}`);
      return;
    }

    console.log(`  ⚠️ 未找到${labelText}输入框`);
  }

  await fillFieldByLabel("商品短标题", productTitle, 'input[placeholder="请输入商品短标题"], input[placeholder*="短标题"]');
  await fillFieldByLabel("广审批文号", approvalNumber, 'input[placeholder*="广审"], input[placeholder*="批文"]');

  const finishBtn = editModal.locator('button:has-text("完成编辑")').first();
  if (await finishBtn.isVisible().catch(() => false)) {
    await finishBtn.click();
    await page.waitForTimeout(3000);
    console.log("  ✓ 已点击完成编辑");
  } else {
    console.log("  ⚠️ 未找到完成编辑按钮，停留在弹窗供查看");
  }
}

async function selectCartAndLink(page, productLink, productTitle, approvalNumber) {
  if (!productLink) {
    console.log("  [跳过] productLink 为空，不设置购物车");
    return;
  }
  console.log("设置购物车...");

  // 视频页："添加标签"区域下的 select-lJTtRL 下拉框
  const tagSelect = page.locator('section:has-text("添加标签") .semi-select, .select-lJTtRL, .anchor-container-hgj7gj .semi-select').first();
  if (!(await tagSelect.isVisible().catch(() => false))) {
    console.log("  未找到购物车下拉框，跳过");
    return;
  }
  await tagSelect.click();
  await page.waitForTimeout(1500);

  // 选购物车
  const cartOpt = page.locator('[role="option"]').filter({ hasText: '购物车' }).first();
  if (await cartOpt.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cartOpt.click();
    await page.waitForTimeout(2000);
    console.log("  已选择购物车");
  } else {
    await page.keyboard.press("Escape");
    console.log("  未找到购物车选项，跳过");
    return;
  }

  // 填链接
  const linkInput = page.locator('#douyin_creator_pc_anchor_jump input, section:has-text("添加标签") input, input[placeholder*="粘贴商品"], input[placeholder*="链接"]').first();
  if (await linkInput.isVisible().catch(() => false)) {
    await linkInput.fill(productLink);
    console.log("  链接已填入");
    // 等页面处理链接（可能自动弹出编辑弹窗，或出现"添加链接"按钮）
    await page.waitForTimeout(3000);
  }

  // 先检测是否已自动弹出编辑弹窗
  let editModal = page.locator('.semi-modal-content').filter({ hasText: '完成编辑' }).first();
  if (await editModal.isVisible().catch(() => false)) {
    console.log("  商品编辑弹窗已自动打开");
  } else {
    // 点击添加链接触发编辑弹窗
    const addBtn = page.locator('span:has-text("添加链接"), button:has-text("添加链接")').first();
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(4000);
    }
  }

  // 再次检测编辑弹窗
  editModal = page.locator('.semi-modal-content').filter({ hasText: '完成编辑' }).first();
  if (await editModal.isVisible().catch(() => false)) {
    const limitModal = page.locator('.semi-modal-content').filter({ hasText: '无法添加购物车' }).first();
    if (await limitModal.isVisible().catch(() => false)) {
      const limitMsg = await limitModal.locator('[class*="modal-message"]').first().textContent().catch(() => "已达到限额");
      throw new Error(`购物车限额: ${limitMsg.trim()}`);
    }
    await fillProductEditModal(page, productTitle, approvalNumber);
  }
}

async function runPublishVideo(options) {
  const accountName = String(options.account || "").trim();
  if (!accountName) throw new Error("缺少 --account");

  const videoKey = String(options.videoKey || "").trim();
  if (!videoKey) throw new Error("缺少 --videoKey");

  const paths = getAccountPaths(accountName);
  await ensureDir(paths.accountDir);
  await ensureDir(paths.dataDir);
  await ensureDir(paths.alertDir);

  const hasStoredAuth = await fileExists(paths.storageStatePath);
  if (!hasStoredAuth) {
    throw new Error(`账号 ${accountName} 缺少 storageState，无法自动发布视频`);
  }

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized"],
  });

  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    storageState: paths.storageStatePath,
  });

  let page;
  try {
    page = await context.newPage();
    attachQrDataUrlSniffer(page);
    console.log(`开始视频发布准备: ${accountName}`);
    console.log(`  [选项] productLink=${JSON.stringify(String(options.productLink || ""))} isAiContent=${JSON.stringify(options.isAiContent)} title=${JSON.stringify(options.title)}`);

    await ensureLoggedIn(page, accountName, paths);

    await page.goto(VIDEO_POST_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[placeholder*="标题"]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.evaluate(() => { window.scrollTo(0, 0); document.body?.scrollIntoView?.(); }).catch(() => {});

    await uploadVideo(page, videoKey, accountName);
    await selectFirstAiCover(page);
    await fillTitleAndDescription(
      page,
      String(options.title || ""),
      String(options.desc || "")
    );
    await selectCartAndLink(
      page,
      String(options.productLink || ""),
      String(options.productTitle || ""),
      String(options.approvalNumber || "")
    );
    await selectSelfDeclaration(page, options.isAiContent === true || options.isAiContent === "true");
    await setScheduleIfNeeded(page, String(options.scheduleAt || ""));

    const publishEnabled = options.publishEnabled !== "false" && options.publishEnabled !== false;
    const publishWaitSec = Number(options.publishWaitSec) || 3;

    if (publishEnabled) {
      console.log("视频发布表单填写完成，点击发布...");
      await clickPublishButton(page);
    } else {
      console.log("视频发布表单填写完成（未点击发布，publishEnabled=false）");
    }

    console.log(`停留 ${publishWaitSec}s 后完成。`);
    await page.waitForTimeout(publishWaitSec * 1000);
  } catch (error) {
    await saveDebugArtifacts(page, accountName, "run-failed").catch(() => {});
    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = { runPublishVideo };
