const path = require("path");
const { chromium } = require("playwright");
const { ensureDir, fileExists } = require("../lib/fs-utils");
const { getAccountPaths } = require("../lib/accounts");
const { BROWSER_VIEWPORT, HEADLESS } = require("../lib/env");
const { attachQrDataUrlSniffer } = require("../lib/qr");
const {
  MATERIALS_DIR,
  saveDebugArtifacts,
  fillTitleAndDescription,
  selectSelfDeclaration,
  setScheduleIfNeeded,
  ensureLoggedIn,
  clickPublishButton,
} = require("./utils");
const {
  logVideoPublishStart,
  gotoVideoPublishPage,
  resolveVideoPublishControls,
} = require("./video-helpers");
const { selectCartAndLinkForVideo } = require("./product-link");

let activeBrowser = null;
let activeContext = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，正在关闭视频发布浏览器...`);
  try {
    if (activeContext) await activeContext.close().catch(() => {});
    if (activeBrowser) await activeBrowser.close().catch(() => {});
  } finally {
    process.exit(signal === "SIGTERM" ? 143 : 130);
  }
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

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
    logVideoPublishStart(accountName, options);

    await ensureLoggedIn(page, accountName, paths);

    await gotoVideoPublishPage(page);

    await uploadVideo(page, videoKey, accountName);
    await selectFirstAiCover(page);
    await fillTitleAndDescription(
      page,
      String(options.title || ""),
      String(options.desc || "")
    );
    await selectCartAndLinkForVideo(
      page,
      String(options.productLink || ""),
      String(options.productTitle || ""),
      String(options.approvalNumber || "")
    );
    await selectSelfDeclaration(page, options.isAiContent === true || options.isAiContent === "true");
    await setScheduleIfNeeded(page, String(options.scheduleAt || ""));

    const { publishEnabled, publishWaitSec } = resolveVideoPublishControls(options);

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
    activeContext = null;
    await browser.close().catch(() => {});
    activeBrowser = null;
  }
}

module.exports = { runPublishVideo };
