const path = require("path");
const { chromium } = require("playwright");
const { ensureDir, fileExists } = require("./lib/fs-utils");
const { getAccountPaths } = require("./lib/accounts");
const { BROWSER_VIEWPORT, HEADLESS } = require("./lib/env");
const { attachQrDataUrlSniffer } = require("./lib/qr");
const { openTargetAndEnsureLogin } = require("./lib/login");

const MATERIALS_DIR = path.resolve(
  process.env.CREATOR_MATERIALS_DIR ||
    path.join(process.cwd(), "storage/creator-materials")
);
const PUBLISH_DEBUG_DIR = path.resolve(
  process.env.CREATOR_PUBLISH_DEBUG_DIR ||
    path.join(process.cwd(), "storage/creator-publish-debug")
);
const ARTICLE_POST_URL =
  "https://creator.douyin.com/creator-micro/content/post/image?default-tab=3&enter_from=publish_page&media_type=image&type=new";

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      i += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

async function saveDebugArtifacts(page, accountName, tag) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeAccount = String(accountName || "unknown").replace(/[\\/:*?"<>|]/g, "_");
  const dir = path.join(PUBLISH_DEBUG_DIR, safeAccount);
  await ensureDir(dir);

  const htmlPath = path.join(dir, `${stamp}-${tag}.html`);
  const screenshotPath = path.join(dir, `${stamp}-${tag}.png`);

  try {
    const html = await page.content();
    require("fs").writeFileSync(htmlPath, html, "utf-8");
  } catch {}

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch {}

  console.log(`已保存调试文件: ${htmlPath}`);
  console.log(`已保存调试截图: ${screenshotPath}`);
}

async function waitVisible(page, selectors, timeout = 15000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const started = Date.now();
  while (Date.now() - started < timeout) {
    for (const selector of list) {
      const loc = page.locator(selector).first();
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`未找到元素: ${list.join(" | ")}`);
}

async function setTextLikeInput(locator, value) {
  await locator.click();
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "input" || tag === "textarea") {
    await locator.fill(value);
    return;
  }
  const nestedInput = locator.locator("input, textarea").first();
  if (await nestedInput.isVisible().catch(() => false)) {
    await nestedInput.fill(value);
    return;
  }
  await locator.fill(value).catch(async () => {
    await locator.press("Meta+A").catch(() => {});
    await locator.type(value);
  });
}

async function uploadImages(page, imageKeys, accountName) {
  const filePaths = imageKeys.map((key) => path.join(MATERIALS_DIR, key));
  for (const filePath of filePaths) {
    if (!(await fileExists(filePath))) {
      throw new Error(`图片文件不存在: ${filePath}`);
    }
  }

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(3000);

  // 设置 filechooser 监听，再点击上传区域
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 15000 }).catch(() => null);

  // 点击"点击上传"文本触发文件选择
  const uploadText = page.getByText("点击上传").first();
  if (await uploadText.isVisible().catch(() => false)) {
    await uploadText.click();
    await page.waitForTimeout(2000);
  } else {
    // 后备：点击包含该文本的父级
    const parent = page.locator('div:has-text("点击上传")').last();
    await parent.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    await fileChooser.setFiles(filePaths);
    console.log(`已选择 ${filePaths.length} 张图片`);
    await page.waitForTimeout(4000);
    return;
  }

  // 后备：直接操作隐藏 file input
  const hiddenInput = page.locator('input[type="file"]').first();
  if ((await hiddenInput.count()) > 0) {
    await hiddenInput.setInputFiles(filePaths);
    console.log(`已选择 ${filePaths.length} 张图片`);
    await page.waitForTimeout(4000);
    return;
  }

  await saveDebugArtifacts(page, accountName, "upload-not-found");
  throw new Error("无法触发文件上传");
}

async function fillTitleAndDescription(page, title, description) {
  const titleInput = await waitVisible(page, [
    'input[placeholder*="标题"]',
    'input[placeholder*="作品标题"]',
  ]);
  await setTextLikeInput(titleInput, title || "");

  const descInput = await waitVisible(page, [
    '[data-placeholder*="描述"]',
    '[contenteditable="true"]',
    'textarea[placeholder*="描述"]',
  ]);

  await setTextLikeInput(descInput, description || "");
  console.log("已填写标题与作品描述");
}

async function selectShoppingCartAndPasteLink(page, productLink) {
  if (!productLink) return;

  const selectTrigger = await waitVisible(page, [
    '#douyin_creator_pc_anchor_jump .semi-select',
    '[id="douyin_creator_pc_anchor_jump"] .semi-select',
    'div.semi-select',
  ]);
  await selectTrigger.click();
  await page.waitForTimeout(1500);

  const cartOption = await waitVisible(page, [
    '[role="option"]',
  ]);
  // 在可见选项中精确匹配"购物车"
  const cart = page.locator('[role="option"]').filter({ hasText: "购物车" }).first();
  if (await cart.isVisible().catch(() => false)) {
    await cart.click();
  } else {
    await cartOption.click();
  }
  console.log("已切换到购物车选项");

  const linkInput = await waitVisible(page, [
    'input[placeholder*="粘贴商品"]',
    'input[placeholder*="链接"]',
    'input[placeholder*="商品"]',
  ]);
  await setTextLikeInput(linkInput, productLink);
  console.log("已填写商品链接");

  // 点击"添加链接"按钮（与输入框同级的 span 元素）
  const addLinkBtn = page.locator('#douyin_creator_pc_anchor_jump span:has-text("添加链接")').first();
  if (await addLinkBtn.isVisible().catch(() => false)) {
    console.log("正在添加商品链接...");
    await addLinkBtn.click();
    await page.waitForTimeout(3000);
  }

  // 检查弹窗：有"完成编辑"=链接成功(商品编辑弹窗)；仅有"确定"=链接失败
  const editModal = page.locator('.semi-modal-content').filter({ hasText: '完成编辑' }).first();
  if (await editModal.isVisible().catch(() => false)) {
    console.log("商品链接已添加，当前停留在商品编辑弹窗，需要人工填写短标题和广审批文号后点击完成编辑。");
  } else {
    const confirmBtn = page.locator('button:has-text("确定")').first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      console.log("⚠️ 商品链接添加失败，请查看页面弹窗提示");
    }
  }
}

async function selectCoverIfNeeded(page, coverImageKey) {
  if (!coverImageKey) return;
  console.log(`已记录封面偏好: ${coverImageKey}，当前版本先停留人工确认，不自动编辑封面。`);
}

async function setScheduleIfNeeded(page, scheduleAt) {
  if (!scheduleAt) return;

  const scheduleToggle = await waitVisible(page, [
    'label:has-text("定时发布")',
    'text=定时发布',
  ]);
  await scheduleToggle.click();

  const inputWrap = await waitVisible(page, [
    '.date-picker-x1Ag_4 .semi-input-wrapper',
    '.semi-datepicker-input .semi-input-wrapper',
    '.semi-datepicker input',
  ]);
  await inputWrap.click();

  const input = await waitVisible(page, [
    '.semi-datepicker input',
    'input[placeholder*="日期"]',
    'input[placeholder*="时间"]',
  ]);

  const d = new Date(scheduleAt);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`无效的定时发布时间: ${scheduleAt}`);
  }
  const pad = (n) => String(n).padStart(2, "0");
  const text = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  await setTextLikeInput(input, text);
  await input.press("Enter").catch(() => {});
  console.log(`已设置定时发布时间: ${text}`);
}

async function runPublishArticle(options) {
  const accountName = String(options.account || "").trim();
  if (!accountName) throw new Error("缺少 --account");

  const imageKeys = String(options.imageKeys || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (imageKeys.length === 0) throw new Error("缺少 --imageKeys");

  const paths = getAccountPaths(accountName);
  await ensureDir(paths.accountDir);
  await ensureDir(paths.dataDir);
  await ensureDir(paths.alertDir);

  const hasStoredAuth = await fileExists(paths.storageStatePath);
  if (!hasStoredAuth) {
    throw new Error(`账号 ${accountName} 缺少 storageState，无法自动发布图文`);
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
    console.log(`开始图文发布准备: ${accountName}`);

    await openTargetAndEnsureLogin(page, paths, accountName, {
      hasStoredAuth: true,
      forceManualLogin: false,
    });

    await page.goto(ARTICLE_POST_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    await uploadImages(page, imageKeys, accountName);
    await fillTitleAndDescription(
      page,
      String(options.title || ""),
      String(options.desc || "")
    );
    await selectShoppingCartAndPasteLink(page, String(options.productLink || ""));
    await selectCoverIfNeeded(page, String(options.coverImageKey || ""));
    await setScheduleIfNeeded(page, String(options.scheduleAt || ""));

    console.log("图文发布已完成自动填写，当前停留在最终发布前，请人工确认后手动点击发布。");
    await page.waitForTimeout(600000);
  } catch (error) {
    await saveDebugArtifacts(page, accountName, "run-failed").catch(() => {});
    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = {
  parseArgs,
  runPublishArticle,
};
