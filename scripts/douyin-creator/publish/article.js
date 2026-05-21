const path = require("path");
const { chromium } = require("../../common/stealth-browser");
const fse = require("fs-extra");
const { getAccountPaths } = require("../core/accounts");
const { PUBLISH_BROWSER_VIEWPORT, HEADLESS } = require("../core/env");
const { attachQrDataUrlSniffer } = require("../core/qr");
const { saveDebugArtifacts, saveRunFailedArtifacts } = require("./debug");
const { fillTitleAndDescription, normalizeDescriptionForPublish } = require("./editor");
const { selectSelfDeclaration, setScheduleIfNeeded } = require("./publish-form");
const {
  ensureLoggedIn,
  clickPublishButton,
  isPublishSmsVerificationVisible,
  handlePublishSmsVerification,
  checkPublishSmsVerificationCompleted,
  checkPublishSubmitted,
  scrollPublishFormToBottom,
  optimizePublishPageForViewing,
  checkImagesUploaded,
  checkTitleFilled,
  checkBodyFilled,
  checkHashtagsSet,
  checkScheduleSet,
  checkProductLinkSet,
  checkProductLinkAbsent,
  checkSelfDeclarationSet,
  checkMusicSelected,
  scaledMs,
  waitForPageSettled
} = require("./runtime");
const {
  createPublishStepRunner,
  shouldSaveStepDebug,
  PUBLISH_SMS_VERIFICATION_STEP_TIMEOUT_MS,
} = require("./step-runner");
const { selectCartAndLinkForArticle } = require("./product-link");

const MAX_HASHTAGS = 5;
const MATERIALS_DIR = path.resolve(
  process.env.CREATOR_MATERIALS_DIR ||
    path.join(process.cwd(), "storage/creator-materials")
);
const ARTICLE_POST_URL =
  "https://creator.douyin.com/creator-micro/content/post/image?default-tab=3&enter_from=publish_page&media_type=image&type=new";

let activeBrowser = null;
let activeContext = null;
let shuttingDown = false;

async function saveStepDebug(page, accountName, tag, options) {
  if (!shouldSaveStepDebug(options)) return;
  await saveDebugArtifacts(page, accountName, `step-${tag}`, options).catch(() => {});
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

async function uploadImages(page, imageKeys, accountName, options = {}) {
  const filePaths = imageKeys.map((key) => path.join(MATERIALS_DIR, key));
  for (const filePath of filePaths) {
    if (!(await fse.pathExists(filePath))) {
      throw new Error(`图片文件不存在: ${filePath}`);
    }
  }

  await waitForPageSettled(page, { afterClick: false, minWaitMs: 3000 });

  const uploadBtn = page.locator('div:has-text("点击上传")').last();
  if (!(await uploadBtn.isVisible({ timeout: scaledMs(5000) }).catch(() => false))) {
    await saveDebugArtifacts(page, accountName, "upload-not-found", options);
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

  await saveDebugArtifacts(page, accountName, "upload-not-found", options);
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
  await fse.ensureDir(paths.accountDir);
  await fse.ensureDir(paths.dataDir);
  await fse.ensureDir(paths.alertDir);

  const hasStoredAuth = await fse.pathExists(paths.storageStatePath);
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
  let runStep;
  let debugOptions = options;
  try {
    page = await context.newPage();
    attachQrDataUrlSniffer(page);
    console.log(`开始图文发布准备: ${accountName}`);
    console.log(`  [选项] productLink=${JSON.stringify(String(options.productLink || ""))} isAiContent=${JSON.stringify(options.isAiContent)} title=${JSON.stringify(options.title)}`);
    ({ runStep, debugOptions } = createPublishStepRunner({
      page,
      accountName,
      flow: "article",
      options,
      saveStepDebug,
    }));

    await runStep(1, "检查登录状态", "01-login", async () => {
      await ensureLoggedIn(page, accountName, paths);
    });

    const { body: expectedBody, hashtags: expectedHashtags } = normalizeDescriptionForPublish(String(options.desc || ""));
    const limitedHashtags = expectedHashtags.slice(0, MAX_HASHTAGS);

    await runStep(2, "进入图文发布页", "02-open-post-page", async () => {
      await page.goto(ARTICLE_POST_URL, { waitUntil: "domcontentloaded" });
      await waitForPageSettled(page, { afterClick: false, minWaitMs: 3000 });
      await optimizePublishPageForViewing(page);
      await page.evaluate(() => { window.scrollTo(0, 0); document.body?.scrollIntoView?.(); }).catch(() => {});
    }, async () => {
      await page.locator('text=点击上传').first().waitFor({
        state: "visible",
        timeout: scaledMs(10000),
      });
    });

    await runStep(3, `上传图文素材: ${imageKeys.length} 张`, "03-upload-images", async () => {
      await uploadImages(page, imageKeys, accountName, debugOptions);
    }, async () => {
      await checkImagesUploaded(page, imageKeys.length);
    });

    if (String(options.scheduleAt || "")) {
      await runStep(4, "校验并设置定时发布", "04-schedule", async () => {
        await setScheduleIfNeeded(page, String(options.scheduleAt || ""));
      }, async () => {
        await checkScheduleSet(page);
      });
    } else {
      await runStep(4, "定时发布（跳过，未配置）", "04-schedule-skipped", null, {
        skipped: true,
        skipReason: "未配置 scheduleAt",
      });
    }

    if (String(options.productLink || "")) {
      await runStep(5, "设置购物车商品链接", "05-product-link", async () => {
        await selectCartAndLinkForArticle(
          page,
          String(options.productLink || ""),
          String(options.productTitle || ""),
          String(options.approvalNumber || "")
        );
      }, async () => {
        await checkProductLinkSet(page, String(options.productTitle || ""));
      });
    } else {
      await runStep(5, "购物车商品链接（跳过，未配置）", "05-product-link-absent", null, async () => {
        await checkProductLinkAbsent(page);
      });
    }

    await runStep(6, "填写标题、正文与话题", "06-title-description-topics", async () => {
      await fillTitleAndDescription(
        page,
        String(options.title || ""),
        String(options.desc || "")
      );
    }, async () => {
      await checkTitleFilled(page, String(options.title || ""));
      await checkBodyFilled(page, expectedBody);
      await checkHashtagsSet(page, limitedHashtags);
    });

    const isAi = options.isAiContent === true || options.isAiContent === "true";
    await runStep(7, "设置自主声明", "07-self-declaration", async () => {
      await selectSelfDeclaration(page, isAi);
    }, async () => {
      await checkSelfDeclarationSet(page, isAi);
    });

    await runStep(8, "选择配乐", "08-music", async () => {
      await selectMusic(page);
    }, async () => {
      await checkMusicSelected(page);
    });

    await runStep(9, "处理封面设置", "09-cover", async () => {
      await selectCoverIfNeeded(page, String(options.coverImageKey || ""));
      await scrollPublishFormToBottom(page);
    });

    const publishEnabled = options.publishEnabled !== "false" && options.publishEnabled !== false;
    const publishWaitSec = Number(options.publishWaitSec) || 3;

    if (publishEnabled) {
      await runStep(10, "点击发布按钮", "10-publish", async () => {
        await clickPublishButton(page, accountName, { handleSms: false });
      });

      if (await isPublishSmsVerificationVisible(page, 1000)) {
        await runStep(
          11,
          "处理短信验证码",
          "11-sms-verification",
          async () => {
            await handlePublishSmsVerification(page, accountName);
          },
          async () => {
            await checkPublishSmsVerificationCompleted(page);
          },
          { timeoutMs: PUBLISH_SMS_VERIFICATION_STEP_TIMEOUT_MS }
        );
      } else {
        await runStep(11, "短信验证码（未出现）", "11-sms-verification-skipped", null, {
          skipped: true,
          skipReason: "未出现短信验证码弹窗",
        });
      }

      await runStep(12, "校验发布提交结果", "12-publish-submit-check", null, async () => {
        await checkPublishSubmitted(page);
      });
    } else {
      await runStep(10, "跳过点击发布（publishEnabled=false）", "10-publish-skipped", null, {
        skipped: true,
        skipReason: "publishEnabled=false",
      });
    }

    await runStep(13, `发布后停留 ${publishWaitSec}s`, "13-post-wait", async () => {
      await page.waitForTimeout(scaledMs(publishWaitSec * 1000));
    });
  } catch (error) {
    await saveRunFailedArtifacts(page, accountName, debugOptions).catch(() => {});
    throw error;
  } finally {
    await context.close().catch(() => {});
    activeContext = null;
    await browser.close().catch(() => {});
    activeBrowser = null;
  }
}

module.exports = { runPublishArticle };
