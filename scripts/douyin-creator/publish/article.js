const path = require("path");
const { chromium } = require("../../common/stealth-browser");
const { ensureDir, fileExists } = require("../../common/fs");
const { getAccountPaths } = require("../lib/accounts");
const { PUBLISH_BROWSER_VIEWPORT, HEADLESS } = require("../lib/env");
const { attachQrDataUrlSniffer } = require("../lib/qr");
const { stage, step, done } = require("./logger");
const {
  MATERIALS_DIR,
  ARTICLE_POST_URL,
  saveDebugArtifacts,
  fillTitleAndDescription,
  selectSelfDeclaration,
  setScheduleIfNeeded,
  ensureLoggedIn,
  clickPublishButton,
  scrollPublishFormToBottom,
  optimizePublishPageForViewing,
  checkImagesUploaded,
  checkTitleFilled,
  checkBodyFilled,
  checkHashtagsSet,
  checkScheduleSet,
  checkProductLinkSet,
  checkSelfDeclarationSet,
  checkMusicSelected,
  normalizeDescriptionForPublish,
  MAX_HASHTAGS,
  scaledMs,
  waitForPageSettled,
} = require("./utils");
const { selectCartAndLinkForArticle } = require("./product-link");

let activeBrowser = null;
let activeContext = null;
let shuttingDown = false;

function shouldSaveStepDebug(options) {
  return (
    options.debugSteps === true ||
    options.debugSteps === "true" ||
    process.env.CREATOR_PUBLISH_DEBUG_STEPS === "true"
  );
}

async function saveStepDebug(page, accountName, tag, options) {
  if (!shouldSaveStepDebug(options)) return;
  await saveDebugArtifacts(page, accountName, `step-${tag}`).catch(() => {});
}

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

  await waitForPageSettled(page, { afterClick: false, minWaitMs: 3000 });

  const uploadBtn = page.locator('div:has-text("点击上传")').last();
  if (!(await uploadBtn.isVisible({ timeout: scaledMs(5000) }).catch(() => false))) {
    await saveDebugArtifacts(page, accountName, "upload-not-found");
    throw new Error("上传按钮不可见，无法触发文件上传");
  }

  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: scaledMs(30000) }).catch(() => null);
  await uploadBtn.click();
  await page.waitForTimeout(scaledMs(2000));

  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    await fileChooser.setFiles(filePaths);
    console.log(`已选择 ${filePaths.length} 张图片`);
    await page.waitForTimeout(scaledMs(8000));
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
  const guideOk = page.locator('button:has-text("我知道了")').first();
  if (await guideOk.isVisible({ timeout: scaledMs(1000) }).catch(() => false)) {
    await guideOk.click().catch(() => {});
    await page.waitForTimeout(scaledMs(500));
  }

  const musicAction = page.locator('span:has-text("选择音乐")').last();
  if (!(await musicAction.isVisible().catch(() => false))) {
    throw new Error("配乐选择失败：未找到选择音乐按钮");
  }

  await musicAction.scrollIntoViewIfNeeded().catch(() => {});
  await musicAction.click({ timeout: scaledMs(5000) }).catch(async (error) => {
    const message = String(error?.message || error || "");
    if (!/intercepts pointer events|Timeout/i.test(message)) throw error;
    console.log("选择音乐按钮被页面浮层遮挡，改用 DOM 点击");
    const clicked = await musicAction
      .evaluate((node) => {
        const target = node.closest("button, [role='button']") || node;
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      })
      .catch(() => false);
    if (!clicked) throw error;
  });
  await page.waitForTimeout(scaledMs(3000));

  const hotTab = page.locator('div[role="tab"]:has-text("热门榜")').first();
  if (!(await hotTab.isVisible({ timeout: scaledMs(5000) }).catch(() => false))) {
    throw new Error("配乐选择失败：未找到热门榜标签");
  }
  await hotTab.click();
  await page.waitForTimeout(scaledMs(3000));

  const songNames = page.locator('.semi-tabs-pane-active [class*="song-name"], [class*="song-name"]');
  const count = await songNames.count().catch(() => 0);
  if (count === 0) {
    throw new Error("配乐选择失败：热门榜无歌曲");
  }

  const startIdx = Math.floor(Math.random() * count);
  for (let offset = 0; offset < Math.min(count, 8); offset += 1) {
    const idx = (startIdx + offset) % count;
    const song = songNames.nth(idx);
    const selectedName = (await song.textContent().catch(() => ""))?.trim();
    console.log(`尝试选择音乐: [${idx}] ${selectedName || "未命名音乐"}`);

    const card = song.locator('xpath=./ancestor::*[contains(@class, "card-wrapper")][1]');
    const target = (await card.count().catch(() => 0)) > 0 ? card.first() : song;
    await target.scrollIntoViewIfNeeded().catch(() => {});
    await target.hover().catch(() => {});
    await page.waitForTimeout(900);

    const clickedUse = await song.evaluate((node) => {
      const cardEl = node.closest('[class*="card-wrapper"]');
      const buttons = Array.from(cardEl?.querySelectorAll('button, [role="button"]') || []);
      const use = buttons.find((button) => (button.textContent || "").trim() === "使用");
      if (!use) return false;
      use.scrollIntoView({ block: "center", inline: "center" });
      use.click();
      return true;
    }).catch(() => false);

    if (clickedUse) {
      await page.waitForTimeout(2500);
      console.log(`已选择音乐: ${selectedName || `第 ${idx + 1} 首`}`);
      return;
    }

    const useBtn = target.locator('button:has-text("使用")').first();
    if (await useBtn.isVisible({ timeout: 1200 }).catch(() => false)) {
      await useBtn.click();
      await page.waitForTimeout(2500);
      console.log(`已选择音乐: ${selectedName || `第 ${idx + 1} 首`}`);
      return;
    }

    await target.click().catch(() => {});
    await page.waitForTimeout(800);
    const confirmBtn = page.locator('button:has-text("确定"), span:has-text("确定")').last();
    if (await confirmBtn.isVisible({ timeout: 1200 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(2000);
      console.log(`已选择音乐（后备方案）: ${selectedName || `第 ${idx + 1} 首`}`);
      return;
    }
  }

  throw new Error("配乐选择失败：音乐列表已遍历多首，仍未找到可点击的使用按钮");
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
    console.log(`开始图文发布准备: ${accountName}`);
    console.log(`  [选项] productLink=${JSON.stringify(String(options.productLink || ""))} isAiContent=${JSON.stringify(options.isAiContent)} title=${JSON.stringify(options.title)}`);

    stage(1, "检查登录状态");
    await ensureLoggedIn(page, accountName, paths);
    await saveStepDebug(page, accountName, "01-login", options);

    const { body: expectedBody, hashtags: expectedHashtags } = normalizeDescriptionForPublish(String(options.desc || ""));
    const limitedHashtags = expectedHashtags.slice(0, MAX_HASHTAGS);

    stage(2, "进入图文发布页");
    await page.goto(ARTICLE_POST_URL, { waitUntil: "domcontentloaded" });
    await waitForPageSettled(page, { afterClick: false, minWaitMs: 3000 });
    await optimizePublishPageForViewing(page);
    await page.evaluate(() => { window.scrollTo(0, 0); document.body?.scrollIntoView?.(); }).catch(() => {});
    await saveStepDebug(page, accountName, "02-open-post-page", options);

    stage(3, `上传图文素材: ${imageKeys.length} 张`);
    await uploadImages(page, imageKeys, accountName);
    await checkImagesUploaded(page, imageKeys.length);
    await saveStepDebug(page, accountName, "03-upload-images", options);

    if (String(options.scheduleAt || "")) {
      stage(4, "校验并设置定时发布");
      await setScheduleIfNeeded(page, String(options.scheduleAt || ""));
      await checkScheduleSet(page);
      await saveStepDebug(page, accountName, "04-schedule", options);
    } else {
      stage(4, "定时发布（跳过，未配置）");
    }

    if (String(options.productLink || "")) {
      stage(5, "设置购物车商品链接");
      await selectCartAndLinkForArticle(
        page,
        String(options.productLink || ""),
        String(options.productTitle || ""),
        String(options.approvalNumber || "")
      );
      await checkProductLinkSet(page);
      await saveStepDebug(page, accountName, "05-product-link", options);
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
    await saveStepDebug(page, accountName, "06-title-description-topics", options);

    stage(7, "设置自主声明");
    const isAi = options.isAiContent === true || options.isAiContent === "true";
    await selectSelfDeclaration(page, isAi);
    await checkSelfDeclarationSet(page, isAi);
    await saveStepDebug(page, accountName, "07-self-declaration", options);

    stage(8, "选择配乐");
    await selectMusic(page);
    await checkMusicSelected(page);
    await saveStepDebug(page, accountName, "08-music", options);

    stage(9, "处理封面设置");
    await selectCoverIfNeeded(page, String(options.coverImageKey || ""));
    await scrollPublishFormToBottom(page);
    await saveStepDebug(page, accountName, "09-cover", options);

    const publishEnabled = options.publishEnabled !== "false" && options.publishEnabled !== false;
    const publishWaitSec = Number(options.publishWaitSec) || 3;

    if (publishEnabled) {
      stage(10, "点击发布按钮");
      await clickPublishButton(page, accountName);
    } else {
      stage(10, "跳过点击发布（publishEnabled=false）");
    }

    stage(11, `发布后停留 ${publishWaitSec}s`);
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

module.exports = { runPublishArticle };
