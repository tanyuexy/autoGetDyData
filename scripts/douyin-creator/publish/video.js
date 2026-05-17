const path = require("path");
const { chromium } = require("playwright");
const { ensureDir, fileExists } = require("../../common/fs");
const { getAccountPaths } = require("../lib/accounts");
const { PUBLISH_BROWSER_VIEWPORT, HEADLESS } = require("../lib/env");
const { attachQrDataUrlSniffer } = require("../lib/qr");
const { stage, step } = require("./logger");
const {
  MATERIALS_DIR,
  saveDebugArtifacts,
  fillTitleAndDescription,
  selectSelfDeclaration,
  setScheduleIfNeeded,
  ensureLoggedIn,
  optimizePublishPageForViewing,
  clickPublishButton,
  checkVideoUploaded,
  checkCoverSelected,
  checkTitleFilled,
  checkBodyFilled,
  checkHashtagsSet,
  checkScheduleSet,
  checkProductLinkSet,
  checkSelfDeclarationSet,
  normalizeDescriptionForPublish,
  MAX_HASHTAGS,
  scaledMs,
  waitForPageSettled,
  VIDEO_POST_URL,
} = require("./utils");
const { selectCartAndLinkForVideo } = require("./product-link");

function logVideoPublishStart(accountName, options) {
  console.log(`开始视频发布准备: ${accountName}`);
  console.log(
    `  [选项] productLink=${JSON.stringify(String(options.productLink || ""))} isAiContent=${JSON.stringify(options.isAiContent)} title=${JSON.stringify(options.title)}`
  );
}

async function gotoVideoPublishPage(page) {
  await page.goto(VIDEO_POST_URL, { waitUntil: "domcontentloaded" });
  await page
    .waitForSelector('input[placeholder*="标题"]', { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  await page
    .evaluate(() => {
      window.scrollTo(0, 0);
      document.body?.scrollIntoView?.();
    })
    .catch(() => {});
}

function resolveVideoPublishControls(options) {
  return {
    publishEnabled:
      options.publishEnabled !== "false" && options.publishEnabled !== false,
    publishWaitSec: Number(options.publishWaitSec) || 3,
  };
}

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
  await page.waitForSelector('input[type="file"][accept*="video"]', { state: 'attached', timeout: scaledMs(30000) }).catch(() => {});
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
    }, { timeout: scaledMs(120000) });
  } catch {}
  await page.waitForTimeout(scaledMs(2000));
}

async function selectFirstFrameAsCover(page) {
  // 等待 AI 推荐封面容器出现（视频上传后封面缩略图是异步生成的）
  const container = await page
    .waitForSelector('[class*="recommendCoverContainer"]', {
      timeout: scaledMs(60000)
    })
    .catch(() => null);
  if (!container) {
    throw new Error("封面容器未出现，无法选择封面");
  }

  const coverItems = page.locator(
    '[class*="recommendCoverContainer"] > [class*="recommendCover"]'
  );

  // 轮询等待至少一个推荐封面渲染完毕（AI 封面 CDN 快，视频首帧 blob URL 慢）
  let foundAny = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const count = await coverItems.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const item = coverItems.nth(i);
      const imgs = await item.locator("img").count().catch(() => 0);
      const visible = await item.isVisible().catch(() => false);
      const classAttr = await item.getAttribute("class").catch(() => "");
      if (imgs > 0 && visible && !/isSetting/i.test(classAttr)) {
        foundAny = true;
        break;
      }
    }
    if (foundAny) break;
    await page.waitForTimeout(2000);
  }

  const coverCount = await coverItems.count().catch(() => 0);
  console.log(`可选封面数: ${coverCount}`);

  if (!foundAny) {
    throw new Error("推荐封面未生成，无法选择封面");
  }

  // 选择封面：优先视频首帧（非 AI 标记），降级为 AI 封面
  let clicked = false;
  // 第一轮：找非 AI 封面（视频首帧）
  for (let i = 0; i < coverCount; i += 1) {
    const item = coverItems.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;
    const classAttr = await item.getAttribute("class").catch(() => "");
    if (/selected/i.test(classAttr) || /isSetting/i.test(classAttr)) continue;
    const hasAi =
      (await item.locator('[class*="ai-"]').count().catch(() => 0)) > 0;
    if (hasAi) continue;
    const imgs = await item.locator("img").count().catch(() => 0);
    if (imgs === 0) continue;

    await item.click().catch(() => {});
    console.log("已选择视频首帧作为封面");
    clicked = true;
    break;
  }
  // 第二轮：降级为 AI 封面
  if (!clicked) {
    for (let i = 0; i < coverCount; i += 1) {
      const item = coverItems.nth(i);
      if (!(await item.isVisible().catch(() => false))) continue;
      const classAttr = await item.getAttribute("class").catch(() => "");
      if (/selected/i.test(classAttr) || /isSetting/i.test(classAttr)) continue;
      const imgs = await item.locator("img").count().catch(() => 0);
      if (imgs === 0) continue;

      await item.click().catch(() => {});
      console.log("视频首帧不可用，已降级选择 AI 推荐封面");
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    throw new Error("无可点击的推荐封面");
  }

  // 等待封面确认弹窗出现，再点击确定（限定在封面确认模态框内）
  await page.waitForTimeout(1000);
  const dialog = page
    .locator('[role="modal"], [role="dialog"]')
    .filter({ hasText: "是否确认应用此封面？" });
  const confirmBtn = dialog.getByRole("button", { name: "确定" });
  if (
    await confirmBtn.isVisible({ timeout: scaledMs(5000) }).catch(() => false)
  ) {
    await confirmBtn.click();
    console.log("已确认应用封面");
    // 等待弹窗关闭
    await confirmBtn
      .waitFor({ state: "hidden", timeout: scaledMs(15000) })
      .catch(() => {});
  } else {
    // 兜底：可能点击后无需确认就已应用（封面停留够久时会出现）
    console.log("封面确认弹窗未出现，尝试按 Escape 关闭残留弹窗");
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
  }

  // 轮询等待封面 selected 标记生效（isSetting 过渡态结束后才会出现）
  for (let attempt = 0; attempt < 20; attempt++) {
    const selectedItem = page
      .locator(
        '[class*="recommendCoverContainer"] > [class*="recommendCover"][class*="selected"]'
      )
      .first();
    if (
      await selectedItem.isVisible({ timeout: 1000 }).catch(() => false)
    ) {
      console.log("封面 selected 标记已生效");
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("封面选择超时：确认后未检测到 selected 标记");
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

    stage(1, "检查登录状态");
    await ensureLoggedIn(page, accountName, paths);

    stage(2, "进入视频发布页");
    await gotoVideoPublishPage(page);
    await optimizePublishPageForViewing(page);

    const { body: expectedBody, hashtags: expectedHashtags } = normalizeDescriptionForPublish(String(options.desc || ""));
    const limitedHashtags = expectedHashtags.slice(0, MAX_HASHTAGS);

    stage(3, `上传视频素材: ${videoKey}`);
    await uploadVideo(page, videoKey, accountName);
    await checkVideoUploaded(page);

    if (String(options.scheduleAt || "")) {
      stage(4, "校验并设置定时发布");
      await setScheduleIfNeeded(page, String(options.scheduleAt || ""));
      await checkScheduleSet(page);
    } else {
      stage(4, "定时发布（跳过，未配置）");
    }

    if (String(options.productLink || "")) {
      stage(5, "设置购物车商品链接");
      await selectCartAndLinkForVideo(
        page,
        String(options.productLink || ""),
        String(options.productTitle || ""),
        String(options.approvalNumber || "")
      );
      await checkProductLinkSet(page);
    } else {
      stage(5, "购物车商品链接（跳过，未配置）");
    }

    stage(6, "填写标题、正文与话题");
    await fillTitleAndDescription(
      page,
      String(options.title || ""),
      String(options.desc || "")
    );
    await checkTitleFilled(page, String(options.title || ""));
    await checkBodyFilled(page, expectedBody);
    await checkHashtagsSet(page, limitedHashtags);

    stage(7, "选择视频首帧封面");
    await selectFirstFrameAsCover(page);
    await checkCoverSelected(page);

    stage(8, "设置自主声明");
    const isAi = options.isAiContent === true || options.isAiContent === "true";
    await selectSelfDeclaration(page, isAi);
    await checkSelfDeclarationSet(page, isAi);

    const { publishEnabled, publishWaitSec } = resolveVideoPublishControls(options);

    if (publishEnabled) {
      stage(9, "点击发布按钮");
      const published = await clickPublishButton(page, accountName);
      if (!published) {
        throw new Error("发布未完成：发布按钮点击后未确认发布成功");
      }
    } else {
      stage(9, "跳过点击发布（publishEnabled=false）");
    }

    stage(10, `发布后停留 ${publishWaitSec}s`);
    await page.waitForTimeout(scaledMs(publishWaitSec * 1000));
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
