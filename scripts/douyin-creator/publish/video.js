const path = require("path");
const { chromium } = require("../../common/stealth-browser");
const fse = require("fs-extra");
const { getAccountPaths } = require("../core/accounts");
const { PUBLISH_BROWSER_VIEWPORT, HEADLESS, getPublishBrowserLaunchOptions } = require("../core/env");
const { attachQrDataUrlSniffer } = require("../core/qr");
const { saveDebugArtifacts, saveRunFailedArtifacts } = require("./debug");
const { fillTitleAndDescription, normalizeDescriptionForPublish } = require("./editor");
const { selectSelfDeclaration, setScheduleIfNeeded } = require("./publish-form");
const {
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
  scaledMs,
} = require("./runtime");
const {
  createPublishStepRunner,
  shouldSaveStepDebug,
  PUBLISH_SMS_VERIFICATION_STEP_TIMEOUT_MS,
} = require("./step-runner");
const { selectCartAndLinkForVideo } = require("./product-link");
const { extractVideoFirstFrameJpeg } = require("./cover-utils");

const MAX_HASHTAGS = 5;
const MATERIALS_DIR = path.resolve(
  process.env.CREATOR_MATERIALS_DIR ||
    path.join(process.cwd(), "storage/creator-materials")
);
const VIDEO_POST_URL =
  "https://creator.douyin.com/creator-micro/content/post/video";

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

function createVideoUploadNetworkMonitor(page) {
  const signals = [];
  const uploadUrlPattern =
    /(upload|material|media|video|aweme|post|publish|creator-micro)/i;
  const failureTextPattern =
    /(上传失败|上传出错|上传异常|上传错误|视频处理失败|转码失败|解析失败|格式不支持|不支持该格式|视频大小超过|文件大小超过|视频时长不符合|upload failed|error)/i;
  const successTextPattern =
    /(success|成功|ok|file[_-]?token|vid|uri|video_id|media_id)/i;

  const onResponse = async (response) => {
    const request = response.request();
    const method = request.method();
    const url = response.url();
    if (!/^(POST|PUT|PATCH)$/i.test(method)) return;
    if (!uploadUrlPattern.test(url)) return;

    const status = response.status();
    const signal = {
      method,
      url,
      status,
      ok: response.ok(),
      success: false,
      failure: status >= 400,
      message: ""
    };

    const contentType = String(response.headers()["content-type"] || "");
    if (/json|text|javascript/i.test(contentType)) {
      const text = await response.text().catch(() => "");
      const compact = text.replace(/\s+/g, " ").trim().slice(0, 500);
      signal.message = compact;
      if (failureTextPattern.test(compact)) signal.failure = true;
      if (response.ok() && successTextPattern.test(compact)) signal.success = true;
    } else if (response.ok()) {
      signal.success = true;
    }

    signals.push(signal);
  };

  page.on("response", onResponse);

  return {
    dispose() {
      page.off("response", onResponse);
    },
    latestFailure() {
      return signals.find((signal) => signal.failure) || null;
    },
    latestSuccess() {
      return [...signals].reverse().find((signal) => signal.success) || null;
    },
    summary() {
      return signals
        .slice(-5)
        .map((signal) => `${signal.method} ${signal.status} ${signal.url}`)
        .join(" | ");
    }
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
  if (!(await fse.pathExists(filePath))) {
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
    var uploadNetwork = createVideoUploadNetworkMonitor(page);
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
    await checkVideoUploaded(page, { timeoutMs: 120000 });
    const success = uploadNetwork?.latestSuccess();
    if (success) {
      console.log(`上传网络响应已确认: ${success.status} ${success.url}`);
    }
    await page.waitForTimeout(scaledMs(1000));
  } catch (error) {
    const failure = uploadNetwork?.latestFailure();
    if (failure) {
      throw new Error(
        `视频上传接口返回异常: ${failure.status} ${failure.url}` +
          (failure.message ? ` | ${failure.message.slice(0, 200)}` : "")
      );
    }
    const networkSummary = uploadNetwork?.summary();
    if (networkSummary) {
      error.message = `${error.message}；上传网络响应: ${networkSummary}`;
    }
    throw error;
  } finally {
    uploadNetwork?.dispose();
  }
}

async function waitCoverApplied(page, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < scaledMs(timeoutMs)) {
    try {
      await checkCoverSelected(page);
      return;
    } catch {
      await page.waitForTimeout(1000);
    }
  }
  throw new Error("封面选择超时：未检测到封面已应用");
}

async function confirmRecommendCoverDialog(page) {
  await page.waitForTimeout(1000);
  const dialog = page
    .locator('[role="modal"], [role="dialog"]')
    .filter({ hasText: "是否确认应用此封面？" });
  const confirmBtn = dialog.getByRole("button", { name: "确定" });
  if (await confirmBtn.isVisible({ timeout: scaledMs(5000) }).catch(() => false)) {
    await confirmBtn.click();
    console.log("已确认应用封面");
    await confirmBtn.waitFor({ state: "hidden", timeout: scaledMs(15000) }).catch(() => {});
    return;
  }
  console.log("封面确认弹窗未出现，尝试关闭残留弹窗");
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);
}

async function tryRecommendCoverQuickSelect(page) {
  const container = await page
    .waitForSelector('[class*="recommendCoverContainer"]', { timeout: scaledMs(60000) })
    .catch(() => null);
  if (!container) return false;

  const coverItems = page.locator(
    '[class*="recommendCoverContainer"] > [class*="recommendCover"]'
  );

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
  if (!foundAny) return false;

  let clicked = false;
  for (let i = 0; i < coverCount; i += 1) {
    const item = coverItems.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;
    const classAttr = await item.getAttribute("class").catch(() => "");
    if (/selected/i.test(classAttr) || /isSetting/i.test(classAttr)) continue;
    const hasAi = (await item.locator('[class*="ai-"]').count().catch(() => 0)) > 0;
    if (hasAi) continue;
    if ((await item.locator("img").count().catch(() => 0)) === 0) continue;
    await item.click().catch(() => {});
    console.log("已选择推荐封面（优先视频首帧）");
    clicked = true;
    break;
  }

  if (!clicked) {
    for (let i = 0; i < coverCount; i += 1) {
      const item = coverItems.nth(i);
      if (!(await item.isVisible().catch(() => false))) continue;
      const classAttr = await item.getAttribute("class").catch(() => "");
      if (/selected/i.test(classAttr) || /isSetting/i.test(classAttr)) continue;
      if ((await item.locator("img").count().catch(() => 0)) === 0) continue;
      await item.click().catch(() => {});
      console.log("已降级选择 AI 推荐封面");
      clicked = true;
      break;
    }
  }

  if (!clicked) return false;
  await confirmRecommendCoverDialog(page);
  await waitCoverApplied(page);
  return true;
}

async function switchCoverUploadTab(page) {
  await page.evaluate(() => {
    const el = Array.from(
      document.querySelectorAll(".semi-modal-content *, [role='dialog'] *")
    ).find((node) => (node.textContent || "").trim() === "上传封面");
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(500);
}

function getCoverUploadFileInput(page) {
  return page
    .locator(
      '.semi-modal-content .semi-upload[class*="upload-"] input[type="file"], [role="dialog"] .semi-upload[class*="upload-"] input[type="file"]'
    )
    .first();
}

async function waitCoverUploadPreviewReady(page, timeoutMs = 60000) {
  await page.waitForFunction(
    () => {
      const imgs = Array.from(
        document.querySelectorAll(".semi-modal-content img, [role='dialog'] img")
      );
      return imgs.some((img) => img.naturalWidth > 400 && img.naturalHeight > 400);
    },
    null,
    { timeout: scaledMs(timeoutMs) }
  );
}

async function waitCoverPortalIdle(page) {
  const spinners = page.locator(
    ".dy-creator-content-portal .semi-spin-block, .dy-creator-content-modal-wrap .semi-spin-block"
  );
  const count = await spinners.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    await spinners
      .nth(i)
      .waitFor({ state: "hidden", timeout: scaledMs(120000) })
      .catch(() => {});
  }
}

async function closeCoverEditorModal(page) {
  const modalWrap = page.locator(".dy-creator-content-modal-wrap").first();
  const visible = await modalWrap
    .isVisible({ timeout: scaledMs(500) })
    .catch(() => false);
  if (!visible) {
    await page.keyboard.press("Escape").catch(() => {});
    return;
  }

  const closeBtn = page
    .locator(".semi-modal-close, .semi-modal .semi-button-close, [aria-label='Close']")
    .first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click({ force: true }).catch(() => {});
  }

  const cancelBtn = page
    .locator('.dy-creator-content-modal-wrap button:has-text("取消")')
    .first();
  if (await cancelBtn.isVisible().catch(() => false)) {
    await cancelBtn.click({ force: true }).catch(() => {});
  }

  await page.keyboard.press("Escape").catch(() => {});
  await modalWrap
    .waitFor({ state: "hidden", timeout: scaledMs(8000) })
    .catch(() => {});
  await page.waitForTimeout(300);
}

function getVerticalCoverEditorModal(page) {
  return page
    .locator('.semi-modal-content, [role="dialog"]')
    .filter({ hasText: "设置竖封面" })
    .first();
}

async function clickVerticalCoverSlot(page) {
  const slot = page
    .locator('[class*="coverControl"]')
    .filter({ hasText: "竖封面3:4" })
    .first();
  await slot.scrollIntoViewIfNeeded().catch(() => {});
  await slot
    .evaluate((root) => {
      const target =
        root.querySelector('[class*="filter"]') ||
        root.querySelector('[class*="title"]') ||
        root;
      target.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    })
    .catch(async () => {
      await slot.click({ force: true, timeout: scaledMs(10000) });
    });
}

async function ensureVerticalCoverEditorOpen(page) {
  const modal = getVerticalCoverEditorModal(page);
  if (await modal.isVisible().catch(() => false)) return modal;

  await closeCoverEditorModal(page);
  await clickVerticalCoverSlot(page);
  await modal.waitFor({ state: "visible", timeout: scaledMs(15000) });
  return modal;
}

async function openVerticalCoverEditor(page) {
  await closeCoverEditorModal(page);
  await clickVerticalCoverSlot(page);
  const modal = getVerticalCoverEditorModal(page);
  await modal.waitFor({ state: "visible", timeout: scaledMs(15000) });
  return modal;
}

async function clickCoverEditorDoneWhenReady(page) {
  const doneBtn = page
    .locator(
      '.semi-modal-content button:has-text("完成"), [role="dialog"] button:has-text("完成")'
    )
    .last();

  await page.waitForFunction(
    () => {
      const buttons = Array.from(
        document.querySelectorAll(".semi-modal-content button, [role='dialog'] button")
      ).filter((el) => (el.textContent || "").trim() === "完成");
      const btn = buttons[buttons.length - 1];
      if (!btn) return false;
      const cls = String(btn.className || "");
      return !btn.disabled && !cls.includes("disabled");
    },
    null,
    { timeout: scaledMs(120000) }
  );

  await doneBtn.click({ force: true });
  await page
    .locator(".dy-creator-content-modal-wrap")
    .first()
    .waitFor({ state: "hidden", timeout: scaledMs(30000) })
    .catch(() => {});
  await page.waitForTimeout(1000);
  await closeCoverEditorModal(page);
}

async function tryCoverEditorCompleteFallback(page) {
  console.log("封面兜底2: 打开封面编辑器并点击完成");
  await ensureVerticalCoverEditorOpen(page);
  await clickCoverEditorDoneWhenReady(page);
  await waitCoverApplied(page);
  console.log("封面兜底2: 完成");
  return true;
}

async function tryUploadVideoFirstFrameFallback(page, videoFilePath) {
  console.log("封面兜底4: 提取视频首帧并上传封面");
  const tempDir = path.join(MATERIALS_DIR, ".cover-temp");
  const framePath = await extractVideoFirstFrameJpeg(videoFilePath, tempDir);

  try {
    await ensureVerticalCoverEditorOpen(page);
    await switchCoverUploadTab(page);

    const fileInput = getCoverUploadFileInput(page);
    await fileInput.waitFor({ state: "attached", timeout: scaledMs(30000) });
    await fileInput.setInputFiles(framePath);
    console.log(`  已上传首帧封面: ${path.basename(framePath)}`);
    await waitCoverUploadPreviewReady(page);

    await clickCoverEditorDoneWhenReady(page);
    await waitCoverApplied(page, HEADLESS ? 8000 : 15000);
    console.log("封面兜底4: 完成");
    return true;
  } finally {
    await fse.remove(framePath).catch(() => {});
  }
}

async function selectFirstFrameAsCover(page, videoKey = "") {
  if (await tryRecommendCoverQuickSelect(page).catch(() => false)) {
    return;
  }

  console.log("推荐封面快速选择失败，尝试封面兜底方案");
  if (HEADLESS) {
    console.log("无头模式：按 兜底4(首帧上传预热) → 兜底2(编辑器完成) 顺序尝试");
  }

  const videoFilePath = videoKey ? path.join(MATERIALS_DIR, videoKey) : "";
  const hasVideoFile = videoFilePath && (await fse.pathExists(videoFilePath));
  const errors = [];

  async function runFallback4() {
    if (!hasVideoFile) {
      if (videoKey) errors.push(`兜底4: 视频文件不存在 (${videoFilePath})`);
      return false;
    }
    try {
      await tryUploadVideoFirstFrameFallback(page, videoFilePath);
      return true;
    } catch (error) {
      errors.push(`兜底4: ${error.message}`);
      console.log(`  ${errors[errors.length - 1]}`);
      await closeCoverEditorModal(page).catch(() => {});
      return false;
    }
  }

  async function runFallback2() {
    try {
      await tryCoverEditorCompleteFallback(page);
      return true;
    } catch (error) {
      errors.push(`兜底2: ${error.message}`);
      console.log(`  ${errors[errors.length - 1]}`);
      await closeCoverEditorModal(page).catch(() => {});
      return false;
    }
  }

  if (await runFallback4()) return;
  if (await runFallback2()) return;

  throw new Error(`所有封面选择方式均失败\n${errors.join("\n")}`);
}

async function runPublishVideo(options) {
  const accountName = String(options.account || "").trim();
  if (!accountName) throw new Error("缺少 --account");

  const videoKey = String(options.videoKey || "").trim();
  if (!videoKey) throw new Error("缺少 --videoKey");

  const paths = getAccountPaths(accountName);
  await fse.ensureDir(paths.accountDir);
  await fse.ensureDir(paths.dataDir);
  await fse.ensureDir(paths.alertDir);

  const hasStoredAuth = await fse.pathExists(paths.storageStatePath);
  if (!hasStoredAuth) {
    throw new Error(`账号 ${accountName} 缺少 storageState，无法自动发布视频`);
  }

  const browser = await chromium.launch(getPublishBrowserLaunchOptions());
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
        await selectFirstFrameAsCover(page, videoKey);
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
          },
          { timeoutMs: PUBLISH_SMS_VERIFICATION_STEP_TIMEOUT_MS }
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

module.exports = { runPublishVideo, selectFirstFrameAsCover };
