const path = require("path");
const { chromium } = require("playwright");
const { ensureDir, fileExists } = require("../../common/fs");
const { getAccountPaths } = require("../lib/accounts");
const { PUBLISH_BROWSER_VIEWPORT, HEADLESS } = require("../lib/env");
const { attachQrDataUrlSniffer } = require("../lib/qr");
const {
  MATERIALS_DIR,
  saveDebugArtifacts,
  fillTitleAndDescription,
  selectSelfDeclaration,
  setScheduleIfNeeded,
  ensureLoggedIn,
  optimizePublishPageForViewing,
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

function logStage(index, text) {
  console.log(`[阶段 ${index}] ${text}`);
}

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
    args: [
      "--start-maximized",
      `--window-size=${PUBLISH_BROWSER_VIEWPORT.width},${PUBLISH_BROWSER_VIEWPORT.height}`,
    ],
  });
  activeBrowser = browser;

  const context = await browser.newContext({
    viewport: PUBLISH_BROWSER_VIEWPORT,
    storageState: paths.storageStatePath,
  });
  activeContext = context;

  let page;
  try {
    page = await context.newPage();
    attachQrDataUrlSniffer(page);
    logVideoPublishStart(accountName, options);

    logStage(1, "检查登录状态");
    await ensureLoggedIn(page, accountName, paths);

    logStage(2, "进入视频发布页");
    await gotoVideoPublishPage(page);
    await optimizePublishPageForViewing(page);

    logStage(3, `上传视频素材: ${videoKey}`);
    await uploadVideo(page, videoKey, accountName);
    logStage(4, "选择推荐封面");
    await selectFirstAiCover(page);
    logStage(5, "校验并设置定时发布");
    await setScheduleIfNeeded(page, String(options.scheduleAt || ""));
    logStage(6, "设置购物车商品链接");
    await selectCartAndLinkForVideo(
      page,
      String(options.productLink || ""),
      String(options.productTitle || ""),
      String(options.approvalNumber || "")
    );
    logStage(7, "填写标题、正文与话题");
    await fillTitleAndDescription(
      page,
      String(options.title || ""),
      String(options.desc || "")
    );
    logStage(8, "设置自主声明");
    await selectSelfDeclaration(page, options.isAiContent === true || options.isAiContent === "true");

    const { publishEnabled, publishWaitSec } = resolveVideoPublishControls(options);

    if (publishEnabled) {
      logStage(9, "点击发布按钮");
      await clickPublishButton(page);
    } else {
      logStage(9, "跳过点击发布（publishEnabled=false）");
    }

    logStage(10, `发布后停留 ${publishWaitSec}s`);
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
