const path = require("path");
const { chromium } = require("playwright");
const { ensureDir, fileExists } = require("../lib/fs-utils");
const { getAccountPaths } = require("../lib/accounts");
const { BROWSER_VIEWPORT, HEADLESS } = require("../lib/env");
const { attachQrDataUrlSniffer } = require("../lib/qr");
const {
  MATERIALS_DIR,
  ARTICLE_POST_URL,
  saveDebugArtifacts,
  fillTitleAndDescription,
  selectSelfDeclaration,
  setScheduleIfNeeded,
  ensureLoggedIn,
  clickPublishButton,
} = require("./utils");
const { selectCartAndLinkForArticle } = require("./product-link");

let activeBrowser = null;
let activeContext = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，正在关闭图文发布浏览器...`);
  try {
    if (activeContext) await activeContext.close().catch(() => {});
    if (activeBrowser) await activeBrowser.close().catch(() => {});
  } finally {
    process.exit(signal === "SIGTERM" ? 143 : 130);
  }
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

async function uploadImages(page, imageKeys, accountName) {
  const filePaths = imageKeys.map((key) => path.join(MATERIALS_DIR, key));
  for (const filePath of filePaths) {
    if (!(await fileExists(filePath))) {
      throw new Error(`图片文件不存在: ${filePath}`);
    }
  }

  await page.waitForTimeout(3000);

  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 15000 }).catch(() => null);

  const uploadText = page.getByText("点击上传").first();
  if (await uploadText.isVisible().catch(() => false)) {
    await uploadText.click();
  } else {
    await page.locator('div:has-text("点击上传")').last().click().catch(() => {});
  }
  await page.waitForTimeout(3000);

  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    await fileChooser.setFiles(filePaths);
    console.log(`已选择 ${filePaths.length} 张图片`);
    await page.waitForTimeout(8000);
    return;
  }

  const hiddenInput = page.locator('input[type="file"]').first();
  if ((await hiddenInput.count()) > 0) {
    await hiddenInput.setInputFiles(filePaths);
    console.log(`已选择 ${filePaths.length} 张图片`);
    await page.waitForTimeout(8000);
    return;
  }

  await saveDebugArtifacts(page, accountName, "upload-not-found");
  throw new Error("无法触发文件上传");
}

async function selectCoverIfNeeded(page, coverImageKey) {
  if (!coverImageKey) return;
  console.log(`已记录封面偏好: ${coverImageKey}，当前版本先停留人工确认，不自动编辑封面。`);
}

async function selectMusic(page) {
  console.log("选择音乐...");
  const musicAction = page.locator('span:has-text("选择音乐")').last();
  if (!(await musicAction.isVisible().catch(() => false))) {
    console.log("未找到选择音乐按钮，跳过");
    return;
  }

  await musicAction.click();
  await page.waitForTimeout(3000);

  const hotTab = page.locator('div[role="tab"]:has-text("热门榜")').first();
  if (!(await hotTab.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log("未找到热门榜标签，跳过");
    return;
  }
  await hotTab.click();
  await page.waitForTimeout(3000);

  const songNames = page.locator('.semi-tabs-pane-active .song-name-oRge4d');
  const count = await songNames.count().catch(() => 0);
  if (count === 0) {
    console.log("热门榜无歌曲，跳过");
    return;
  }

  const randomIdx = Math.floor(Math.random() * count);
  const selectedName = await songNames.nth(randomIdx).textContent();
  console.log(`随机选择音乐: [${randomIdx}] ${selectedName}`);

  const targetCard = songNames.nth(randomIdx).locator('xpath=./ancestor::div[contains(@class, "card-wrapper")]');
  await targetCard.hover().catch(() => {});
  await page.waitForTimeout(1500);

  const useBtn = targetCard.locator('button:has-text("使用")').first();
  if (await useBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await useBtn.click();
    await page.waitForTimeout(2000);
    console.log("已选择音乐并关闭面板");
  } else {
    await targetCard.click();
    await page.waitForTimeout(1000);
    const confirmBtn = page.locator('button:has-text("确定")').last();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(2000);
      console.log("已选择音乐（后备方案）");
    }
  }
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
  activeBrowser = browser;

  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    storageState: paths.storageStatePath,
  });
  activeContext = context;

  let page;
  try {
    page = await context.newPage();
    attachQrDataUrlSniffer(page);
    console.log(`开始图文发布准备: ${accountName}`);
    console.log(`  [选项] productLink=${JSON.stringify(String(options.productLink || ""))} isAiContent=${JSON.stringify(options.isAiContent)} title=${JSON.stringify(options.title)}`);

    await ensureLoggedIn(page, accountName, paths);

    await page.goto(ARTICLE_POST_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await page.evaluate(() => { window.scrollTo(0, 0); document.body?.scrollIntoView?.(); }).catch(() => {});

    await uploadImages(page, imageKeys, accountName);
    await fillTitleAndDescription(
      page,
      String(options.title || ""),
      String(options.desc || "")
    );
    await selectCartAndLinkForArticle(
      page,
      String(options.productLink || ""),
      String(options.productTitle || ""),
      String(options.approvalNumber || "")
    );
    await selectSelfDeclaration(page, options.isAiContent === true || options.isAiContent === "true");
    await selectMusic(page);
    await selectCoverIfNeeded(page, String(options.coverImageKey || ""));
    await setScheduleIfNeeded(page, String(options.scheduleAt || ""));

    const publishEnabled = options.publishEnabled !== "false" && options.publishEnabled !== false;
    const publishWaitSec = Number(options.publishWaitSec) || 3;

    if (publishEnabled) {
      console.log("图文发布表单填写完成，点击发布...");
      await clickPublishButton(page);
    } else {
      console.log("图文发布表单填写完成（未点击发布，publishEnabled=false）");
    }

    console.log(`停留 ${publishWaitSec}s 后完成。`);
    await page.waitForTimeout(publishWaitSec * 1000);
  } catch (error) {
    await saveDebugArtifacts(page, accountName, "run-failed").catch(() => {});
    throw error;
  } finally {
    await context.close().catch(() => {});
    activeContext = null;
    await browser.close().catch(() => {});
    activeBrowser = null;
  }
}

module.exports = { runPublishArticle };
