const path = require("path");
const { chromium } = require("../../common/stealth-browser");
const { ensureDir, fileExists } = require("../../common/fs");
const { getAccountPaths } = require("../lib/accounts");
const { PUBLISH_BROWSER_VIEWPORT, HEADLESS } = require("../lib/env");
const { attachQrDataUrlSniffer } = require("../lib/qr");
const {
  MATERIALS_DIR,
  saveDebugArtifacts,
  saveRunFailedArtifacts,
  fillTitleAndDescription,
  selectSelfDeclaration,
  setScheduleIfNeeded,
  ensureLoggedIn,
  optimizePublishPageForViewing,
  clickPublishButton,
  isPublishSmsVerificationVisible,
  handlePublishSmsVerification,
  checkPublishSmsVerificationCompleted,
  checkPublishSubmitted,
  checkVideoUploaded,
  checkCoverSelected,
  checkTitleFilled,
  checkBodyFilled,
  checkHashtagsSet,
  checkScheduleSet,
  checkProductLinkSet,
  checkProductLinkAbsent,
  checkSelfDeclarationSet,
  normalizeDescriptionForPublish,
  MAX_HASHTAGS,
  scaledMs,
  VIDEO_POST_URL,
  createPublishStepRunner,
  shouldSaveStepDebug
} = require("./utils");
const { selectCartAndLinkForVideo } = require("./product-link");

function logVideoPublishStart(accountName, options) {
  console.log(`开始视频发布准备: ${accountName}`);
  console.log(
    `  [选项] productLink=${JSON.stringify(String(options.productLink || ""))} isAiContent=${JSON.stringify(options.isAiContent)} title=${JSON.stringify(options.title)}`
  );
}

async function saveStepDebug(page, accountName, tag, options) {
  if (!shouldSaveStepDebug(options)) return;
  await saveDebugArtifacts(
    page,
    accountName,
    `video-step-${tag}`,
    options
  ).catch(() => {});
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
    publishWaitSec: Number(options.publishWaitSec) || 3
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

async function uploadVideo(page, videoKey, accountName, options = {}) {
  const filePath = path.join(MATERIALS_DIR, videoKey);
  if (!(await fileExists(filePath))) {
    throw new Error(`视频文件不存在: ${filePath}`);
  }

  // 视频页面 file input 是隐藏的，用 attached 状态检测
  await page
    .waitForSelector('input[type="file"][accept*="video"]', {
      state: "attached",
      timeout: scaledMs(30000)
    })
    .catch(() => {});
  const videoInput = page
    .locator('input[type="file"][accept*="video"]')
    .first();
  if ((await videoInput.count()) > 0) {
    await videoInput.setInputFiles(filePath);
    console.log(`已选择视频文件: ${videoKey}`);
  } else {
    await saveDebugArtifacts(
      page,
      accountName,
      "video-upload-not-found",
      options
    );
    throw new Error("无法触发视频上传");
  }

  console.log("等待视频上传完成...");
  try {
    await page.waitForFunction(
      () => {
        const video = document.querySelector("video");
        const blobImg = document.querySelector('img[src^="blob:"]');
        return video || blobImg;
      },
      { timeout: scaledMs(120000) }
    );
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
      const imgs = await item
        .locator("img")
        .count()
        .catch(() => 0);
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
      (await item
        .locator('[class*="ai-"]')
        .count()
        .catch(() => 0)) > 0;
    if (hasAi) continue;
    const imgs = await item
      .locator("img")
      .count()
      .catch(() => 0);
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
      const imgs = await item
        .locator("img")
        .count()
        .catch(() => 0);
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
    if (await selectedItem.isVisible({ timeout: 1000 }).catch(() => false)) {
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
      `--window-size=${PUBLISH_BROWSER_VIEWPORT.width},${PUBLISH_BROWSER_VIEWPORT.height}`
    ]
  });
  activeBrowser = browser;

  const context = await browser.newContext({
    viewport: PUBLISH_BROWSER_VIEWPORT,
    storageState: paths.storageStatePath
  });
  activeContext = context;

  let page;
  let runStep;
  let debugOptions = options;
  try {
    page = await context.newPage();
    attachQrDataUrlSniffer(page);
    logVideoPublishStart(accountName, options);
    ({ runStep, debugOptions } = createPublishStepRunner({
      page,
      accountName,
      flow: "video",
      options,
      saveStepDebug
    }));

    await runStep(1, "检查登录状态", "01-login", async () => {
      await ensureLoggedIn(page, accountName, paths);
    });

    await runStep(
      2,
      "进入视频发布页",
      "02-open-post-page",
      async () => {
        await gotoVideoPublishPage(page);
        await optimizePublishPageForViewing(page);
      },
      async () => {
        await page
          .locator('input[placeholder*="标题"], [contenteditable="true"]')
          .first()
          .waitFor({
            state: "visible",
            timeout: scaledMs(10000)
          });
      }
    );

    const { body: expectedBody, hashtags: expectedHashtags } =
      normalizeDescriptionForPublish(String(options.desc || ""));
    const limitedHashtags = expectedHashtags.slice(0, MAX_HASHTAGS);

    await runStep(
      3,
      `上传视频素材: ${videoKey}`,
      "03-upload-video",
      async () => {
        await uploadVideo(page, videoKey, accountName, debugOptions);
      },
      async () => {
        await checkVideoUploaded(page);
      }
    );

    if (String(options.scheduleAt || "")) {
      await runStep(
        4,
        "校验并设置定时发布",
        "04-schedule",
        async () => {
          await setScheduleIfNeeded(page, String(options.scheduleAt || ""));
        },
        async () => {
          await checkScheduleSet(page);
        }
      );
    } else {
      await runStep(
        4,
        "定时发布（跳过，未配置）",
        "04-schedule-skipped",
        null,
        {
          skipped: true,
          skipReason: "未配置 scheduleAt"
        }
      );
    }

    if (String(options.productLink || "")) {
      await runStep(
        5,
        "设置购物车商品链接",
        "05-product-link",
        async () => {
          await selectCartAndLinkForVideo(
            page,
            String(options.productLink || ""),
            String(options.productTitle || ""),
            String(options.approvalNumber || "")
          );
        },
        async () => {
          await checkProductLinkSet(page, String(options.productTitle || ""));
        }
      );
    } else {
      await runStep(
        5,
        "购物车商品链接（跳过，未配置）",
        "05-product-link-absent",
        null,
        async () => {
          await checkProductLinkAbsent(page);
        }
      );
    }

    await runStep(
      6,
      "填写标题、正文与话题",
      "06-title-description-topics",
      async () => {
        await fillTitleAndDescription(
          page,
          String(options.title || ""),
          String(options.desc || "")
        );
      },
      async () => {
        await checkTitleFilled(page, String(options.title || ""));
        await checkBodyFilled(page, expectedBody);
        await checkHashtagsSet(page, limitedHashtags);
      }
    );

    await runStep(
      7,
      "选择视频首帧封面",
      "07-cover",
      async () => {
        await selectFirstFrameAsCover(page);
      },
      async () => {
        await checkCoverSelected(page);
      }
    );

    const isAi = options.isAiContent === true || options.isAiContent === "true";
    await runStep(
      8,
      "设置自主声明",
      "08-self-declaration",
      async () => {
        await selectSelfDeclaration(page, isAi);
      },
      async () => {
        await checkSelfDeclarationSet(page, isAi);
      }
    );

    const { publishEnabled, publishWaitSec } =
      resolveVideoPublishControls(options);

    if (publishEnabled) {
      await runStep(9, "点击发布按钮", "09-publish", async () => {
        await clickPublishButton(page, accountName, { handleSms: false });
      });

      if (await isPublishSmsVerificationVisible(page, 1000)) {
        await runStep(
          10,
          "处理短信验证码",
          "10-sms-verification",
          async () => {
            await handlePublishSmsVerification(page, accountName);
          },
          async () => {
            await checkPublishSmsVerificationCompleted(page);
          }
        );
      } else {
        await runStep(
          10,
          "短信验证码（未出现）",
          "10-sms-verification-skipped",
          null,
          {
            skipped: true,
            skipReason: "未出现短信验证码弹窗"
          }
        );
      }

      await runStep(
        11,
        "校验发布提交结果",
        "11-publish-submit-check",
        null,
        async () => {
          await checkPublishSubmitted(page);
        }
      );
    } else {
      await runStep(
        9,
        "跳过点击发布（publishEnabled=false）",
        "09-publish-skipped",
        null,
        {
          skipped: true,
          skipReason: "publishEnabled=false"
        }
      );
    }

    await runStep(
      12,
      `发布后停留 ${publishWaitSec}s`,
      "12-post-wait",
      async () => {
        await page.waitForTimeout(scaledMs(publishWaitSec * 1000));
      }
    );
  } catch (error) {
    await saveRunFailedArtifacts(page, accountName, debugOptions).catch(
      () => {}
    );
    throw error;
  } finally {
    await context.close().catch(() => {});
    activeContext = null;
    await browser.close().catch(() => {});
    activeBrowser = null;
  }
}

module.exports = { runPublishVideo };
