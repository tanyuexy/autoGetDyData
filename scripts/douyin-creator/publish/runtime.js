const {
  isLoggedInAtTarget,
  isVerificationUiVisible,
  openTargetAndEnsureLogin
} = require("../core/browser-login");
const {
  TARGET_URL,
  PUBLISH_WAIT_MULTIPLIER,
  LOGIN_WAIT_TIMEOUT_MS
} = require("../core/env");
const { step, checkOk } = require("./logger");
const { fetchOtpCode, sendReceiveOtpEmail } = require("../core/notification");
const { fillReceiveOtpCodeAndSubmit } = require("../core/verification");
const {
  otpRequestIdByAccount,
  otpRequestSinceByAccount,
  otpLastAppliedByAccount,
  otpLastStatusLogAtByAccount
} = require("../core/state");
const { topicTextMatches } = require("./editor");

// ---- 自动慢网识别 ----

/** 已校准的倍率，null 表示尚未校准 */
let _calibratedMultiplier = null;

/** 首次 networkidle 的基准耗时（毫秒），低于此值视为快网 */
const NETWORK_IDLE_BASELINE_MS = 3000;

/** 最终使用的倍率 = max(环境变量, 自动校准)，上限 5 */
function scaledMs(ms) {
  if (_calibratedMultiplier === null) {
    return Math.round(ms * PUBLISH_WAIT_MULTIPLIER);
  }
  const m = Math.max(PUBLISH_WAIT_MULTIPLIER, _calibratedMultiplier);
  return Math.round(ms * Math.min(m, 5));
}

function networkLabel(multiplier) {
  if (multiplier <= 1.0) return "流畅";
  if (multiplier <= 1.5) return "一般";
  if (multiplier <= 2.5) return "较慢";
  if (multiplier <= 4.0) return "缓慢";
  return "极慢";
}

/**
 * 自动校准网络速度。在首次大页面加载后调用一次即可。
 * 测量 networkidle 耗时 vs 基准，自动提升后续等待倍率。
 */
async function calibrateNetworkSpeed(
  page,
  { baselineMs = NETWORK_IDLE_BASELINE_MS } = {}
) {
  if (_calibratedMultiplier !== null) return;
  try {
    const start = Date.now();
    await page.waitForLoadState("networkidle").catch(() => {});
    const elapsed = Date.now() - start;
    const computed = Math.min(
      Math.max(1, Math.round((elapsed / baselineMs) * 10) / 10),
      5
    );
    _calibratedMultiplier = computed;

    const envNote =
      PUBLISH_WAIT_MULTIPLIER > 1
        ? `（环境变量强制 ×${PUBLISH_WAIT_MULTIPLIER}）`
        : "";
    console.log(
      `[网络环境] ${networkLabel(getCalibratedMultiplier())} | ` +
        `networkidle ${elapsed}ms / 基准 ${baselineMs}ms → 倍率 ×${_calibratedMultiplier}${envNote}`
    );
  } catch {
    _calibratedMultiplier = 1;
    console.log("[网络环境] 校准失败，使用默认倍率 ×1.0");
  }
}

/** 返回当前生效的倍率（调试用） */
function getCalibratedMultiplier() {
  return _calibratedMultiplier === null
    ? PUBLISH_WAIT_MULTIPLIER
    : Math.max(PUBLISH_WAIT_MULTIPLIER, _calibratedMultiplier);
}

// ---- 工具函数 ----

async function waitForPageSettled(page, opts = {}) {
  const { afterClick = true, minWaitMs = 500 } = opts;
  if (afterClick) {
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  await page.waitForTimeout(scaledMs(minWaitMs));
}

async function waitForLoginCheckToSettle(page, accountName) {
  let y = 3;
  for (let i = 0; i < y; i += 1) {
    if (await isLoggedInAtTarget(page)) {
      return "logged_in";
    }
    if (await isVerificationUiVisible(page)) {
      return "login_required";
    }

    console.log(
      `账号 [${accountName}] 登录态暂未确认，等待页面稳定... (${i + 1}/${y})`
    );
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(scaledMs(1500));
  }

  await page
    .goto(TARGET_URL, { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(scaledMs(1500));

  if (await isLoggedInAtTarget(page)) {
    return "logged_in";
  }
  if (await isVerificationUiVisible(page)) {
    return "login_required";
  }

  return "unknown";
}

async function ensureLoggedIn(page, accountName, paths) {
  console.log(`检查账号 [${accountName}] 登录状态...`);
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  // 利用首帧加载自动校准慢网倍率（后续所有等待自动适配）
  await calibrateNetworkSpeed(page);
  await waitForPageSettled(page, { afterClick: false, minWaitMs: 3000 });

  if (await isLoggedInAtTarget(page)) {
    console.log(`账号 [${accountName}] 登录态有效`);
    return;
  }

  const loginStatus = await waitForLoginCheckToSettle(page, accountName);
  if (loginStatus === "logged_in") {
    console.log(`账号 [${accountName}] 登录态有效`);
    return;
  }

  const reason = "cookies/storageState 失效或已过期";
  if (loginStatus === "login_required") {
    console.log(
      `账号 [${accountName}] 检测到登录/验证页面，${reason}，进入登录流程`
    );
  } else {
    console.log(
      `账号 [${accountName}] 未能确认登录态，${reason}，进入登录流程`
    );
  }

  await openTargetAndEnsureLogin(page, paths, accountName, {
    hasStoredAuth: true,
    forceManualLogin: true,
    manualLoginReason: reason,
    sendLoginAlerts: true,
    context: page.context(),
    skipInitialNavigation: true
  });

  // 发布流程专属的额外验证重试
  console.log(`账号 [${accountName}] 登录流程完成，验证状态...`);
  await waitForPageSettled(page, { afterClick: false, minWaitMs: 3000 });
  for (let i = 0; i < 3; i += 1) {
    if (await isLoggedInAtTarget(page)) break;
    console.log(`  验证未通过，等待渲染... (${i + 1}/3)`);
    await waitForPageSettled(page, { afterClick: false, minWaitMs: 3000 });
  }

  if (!(await isLoggedInAtTarget(page))) {
    throw new Error(`账号 ${accountName} 登录验证未通过`);
  }

  console.log(`账号 [${accountName}] 登录态已确认`);
}

async function closeCreatorGuides(page) {
  const buttons = [
    'button:has-text("我知道了")',
    'button:has-text("知道了")',
    'button:has-text("跳过")'
  ];
  for (const selector of buttons) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

async function scrollPublishFormToBottom(page) {
  await closeCreatorGuides(page);
  await page
    .evaluate(() => {
      const canScroll = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return (
          el.scrollHeight > el.clientHeight + 40 &&
          /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`)
        );
      };

      const candidates = Array.from(
        document.querySelectorAll("main, section, div")
      )
        .filter(canScroll)
        .map((el) => {
          const text = el.textContent || "";
          const score =
            (text.includes("发布设置") ? 5 : 0) +
            (text.includes("暂存离开") ? 4 : 0) +
            (text.includes("定时发布") ? 3 : 0) +
            (text.includes("作品描述") ? 2 : 0) +
            Math.min(el.scrollHeight - el.clientHeight, 2000) / 2000;
          return { el, score };
        })
        .sort((a, b) => b.score - a.score);

      const target =
        candidates[0]?.el ||
        document.scrollingElement ||
        document.documentElement;
      target.scrollTop = target.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    })
    .catch(() => {});
  await page.waitForTimeout(scaledMs(500));
}

async function optimizePublishPageForViewing(page) {
  await closeCreatorGuides(page);
  const envZoom = Number(process.env.PUBLISH_PAGE_ZOOM);
  const zoom =
    Number.isFinite(envZoom) && envZoom >= 0.6 && envZoom <= 1.2
      ? envZoom
      : 0.65;
  await page
    .evaluate((value) => {
      document.documentElement.style.zoom = String(value);
      document.body.style.zoom = "";
    }, zoom)
    .catch(() => {});
  await page.waitForTimeout(300);
}

/** 获取验证码按钮重试间隔：55 秒后开始检测（倒计时通常 60s，提前 5s 检测防止错过） */
const PUBLISH_SMS_RESEND_INTERVAL_MS = 55_000;

/** 读取页面上的 SMS 验证码弹窗信息（全文搜索手机号模式） */
async function readPublishSmsDialogInfo(page) {
  const panel = page.locator("text=接收短信验证码").first();
  if (!(await panel.isVisible({ timeout: 800 }).catch(() => false))) {
    return null;
  }
  // 全文搜索掩码手机号（如 139******71）
  const bodyText = (await page.textContent("*").catch(() => "")) || "";
  const phoneMatch = bodyText.match(/\d{3}\*{3,6}\d{2,3}/);
  const maskedPhone = phoneMatch ? phoneMatch[0] : "";
  return { maskedPhone };
}

/** 点击 SMS 验证码弹窗中的发送/重发按钮（精确匹配，避免误匹配正文） */
async function clickGetSmsCodeIfVisible(page) {
  const getCodeBtn = page
    .locator(
      'p:has-text("获取验证码"), p:has-text("重新发送"), p:has-text("重新获取")'
    )
    .filter({ hasText: /^(获取验证码|重新发送|重新获取)$/ })
    .first();
  if (await getCodeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await getCodeBtn.click().catch(() => {});
    return true;
  }
  return false;
}

async function isPublishSmsVerificationVisible(page, timeoutMs = 800) {
  return page
    .locator("text=接收短信验证码")
    .first()
    .isVisible({ timeout: scaledMs(timeoutMs) })
    .catch(() => false);
}

/** 处理发布时的短信验证码弹窗：触发发送、轮询 OTP、自动回填 */
async function handlePublishSmsVerification(page, accountName) {
  console.log("  ⚠️ 检测到短信验证码弹窗，开始自动处理...");

  const smsInfo = await readPublishSmsDialogInfo(page);
  const maskedPhone = smsInfo?.maskedPhone || "";
  if (maskedPhone) {
    console.log(`  识别到手机号: ${maskedPhone}`);
  } else {
    console.log("  未识别到手机号，继续处理");
  }

  // 1. 立即点击"获取验证码"触发 Douyin 发送短信
  const clicked = await clickGetSmsCodeIfVisible(page);
  if (clicked) {
    console.log("  ✓ 已触发获取验证码");
  }

  // 2. 通知用户填写验证码（内部会创建 OTP bridge 会话）
  const now = Date.now();
  let requestId = otpRequestIdByAccount.get(accountName) || "";
  otpRequestSinceByAccount.set(accountName, now);
  otpLastAppliedByAccount.delete(accountName);
  otpLastStatusLogAtByAccount.delete(accountName);

  // 3. 发送企业微信通知（内部会重新创建 session 并覆盖 otpRequestIdByAccount）
  await sendReceiveOtpEmail({
    accountName,
    maskedPhone,
    reason: "发布作品时需短信验证码"
  }).catch((e) => {
    console.error("  发送验证码通知失败:", e?.message || e);
  });

  // sendReceiveOtpEmail 内部可能重建了 session，以最新的 requestId 为准
  requestId = otpRequestIdByAccount.get(accountName) || requestId;

  // 4. 轮询 OTP 中转页 + IMAP
  const pollIntervalMs = 3000;
  const deadline = Date.now() + LOGIN_WAIT_TIMEOUT_MS;
  let otpCode = "";
  let lastResendAt = Date.now();

  console.log(
    `  开始轮询验证码（超时 ${Math.round(LOGIN_WAIT_TIMEOUT_MS / 1000)}s）...`
  );
  while (Date.now() < deadline) {
    // 检查 SMS 面板是否已消失（可能用户手动完成或页面已跳转）
    const stillSmsPanel = await page
      .locator("text=接收短信验证码")
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (!stillSmsPanel) {
      console.log("  SMS 面板已消失，检查发布结果...");
      break;
    }

    // 如果"获取验证码"按钮重新可用（验证码已过期），重新点击
    if (Date.now() - lastResendAt > PUBLISH_SMS_RESEND_INTERVAL_MS) {
      const reclicked = await clickGetSmsCodeIfVisible(page);
      if (reclicked) {
        console.log("  🔄 验证码已过期，已重新点击获取验证码");
        lastResendAt = Date.now();
      }
    }

    // 从 OTP 中转页 / IMAP 获取验证码
    const pollResult = await fetchOtpCode({
      accountName,
      requestId,
      sinceMs: now
    }).catch(() => ({ otpCode: "" }));
    if (pollResult.otpCode) {
      otpCode = pollResult.otpCode;
      console.log(`  ✓ 已获取验证码: ${otpCode}`);
      break;
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  if (!otpCode) {
    throw new Error("等待验证码超时");
  }

  // 5. 回填验证码并点击验证（复用 verification.js 的经过验证的选择器）
  const filled = await fillReceiveOtpCodeAndSubmit(page, otpCode);
  if (!filled) {
    throw new Error("回填验证码失败：未找到验证码输入框");
  }
  console.log(`  ✓ 已回填验证码: ${otpCode}`);
  otpLastAppliedByAccount.set(accountName, otpCode);

  // 6. 等待 SMS 弹窗关闭（验证通过会消失，最长等 30s）
  const smsPanel = page.locator("text=接收短信验证码").first();
  for (let i = 0; i < 60; i++) {
    const stillVisible = await smsPanel
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (!stillVisible) {
      console.log("  ✓ SMS 弹窗已关闭");
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (await smsPanel.isVisible({ timeout: 500 }).catch(() => false)) {
    throw new Error("SMS 验证弹窗未关闭，验证未通过");
  }

  return true;
}

async function checkPublishSmsVerificationCompleted(page) {
  const stillVisible = await isPublishSmsVerificationVisible(page, 1000);
  if (stillVisible) {
    throw new Error("短信验证码校验失败：验证码弹窗仍未关闭");
  }
  checkOk("短信验证码校验通过");
}

async function clickPublishButton(page, accountName, options = {}) {
  const { handleSms = true } = options;
  console.log("点击发布按钮...");
  await scrollPublishFormToBottom(page);

  const publishBtn = page
    .locator(
      [
        'button:has-text("发布"):not(:has-text("定时")):not(:has-text("高清"))'
      ].join(", ")
    )
    .first();

  if (
    !(await publishBtn
      .isVisible({ timeout: scaledMs(5000) })
      .catch(() => false))
  ) {
    throw new Error("未找到发布按钮");
  }

  const isDisabled = await publishBtn.isDisabled().catch(() => false);
  if (isDisabled) {
    throw new Error("发布按钮处于禁用状态，可能必填字段未填写完成");
  }

  await publishBtn.scrollIntoViewIfNeeded().catch(() => {});
  await publishBtn.click();
  console.log("  ✓ 已点击发布按钮");

  await page.waitForTimeout(scaledMs(1000));

  // 处理"未添加自主声明"确认对话框
  const declarationDialogTitle = page.locator("text=未添加自主声明").first();
  if (
    await declarationDialogTitle
      .isVisible({ timeout: scaledMs(2000) })
      .catch(() => false)
  ) {
    console.log("  检测到自主声明确认对话框，点击「直接发布」");
    const directPublishBtn = page
      .locator('button:has-text("直接发布")')
      .first();
    if (
      await directPublishBtn
        .isVisible({ timeout: scaledMs(2000) })
        .catch(() => false)
    ) {
      await directPublishBtn.click();
      console.log("  ✓ 已点击「直接发布」");
      await page.waitForTimeout(scaledMs(1000));
    }
  }

  // 处理 SMS 验证码弹窗
  const smsPanel = page.locator("text=接收短信验证码").first();
  if (
    await smsPanel
      .isVisible({ timeout: scaledMs(handleSms ? 2000 : 8000) })
      .catch(() => false)
  ) {
    if (!handleSms) {
      console.log("  检测到短信验证码弹窗，交给独立短信验证步骤处理");
      return true;
    }
    await handlePublishSmsVerification(page, accountName);
    // 点击验证后等待结果
    await page.waitForTimeout(scaledMs(5000));
  }

  // 等待最终 toast 结果
  const toastSelector =
    '.semi-toast-content, .semi-message, [class*="toast"], [class*="message"]';
  try {
    const toast = await page
      .waitForSelector(toastSelector, { timeout: scaledMs(25000) })
      .catch(() => null);
    if (toast) {
      const toastText = await toast.textContent().catch(() => "");
      console.log(`  提示信息: ${toastText.slice(0, 100)}`);
      if (toastText.includes("发布成功") || toastText.includes("success")) {
        console.log("  ✅ 发布成功");
        return true;
      }
      if (
        toastText.includes("失败") ||
        toastText.includes("错误") ||
        toastText.includes("违规")
      ) {
        throw new Error(`发布失败: ${toastText.slice(0, 200)}`);
      }
      // "正在发布" 等中间状态：继续等待更长时间
      if (toastText.includes("正在发布")) {
        console.log("  检测到「正在发布」状态，继续等待...");
        await page.waitForTimeout(scaledMs(10000));
        // 再次检查 toast
        const finalToast = await page
          .waitForSelector(toastSelector, { timeout: scaledMs(30000) })
          .catch(() => null);
        if (finalToast) {
          const finalText = await finalToast.textContent().catch(() => "");
          console.log(`  最终提示: ${finalText.slice(0, 100)}`);
          if (finalText.includes("发布成功") || finalText.includes("success")) {
            console.log("  ✅ 发布成功");
            return true;
          }
          if (
            finalText.includes("失败") ||
            finalText.includes("错误") ||
            finalText.includes("违规")
          ) {
            throw new Error(`发布失败: ${finalText.slice(0, 200)}`);
          }
        }
      }
    }
  } catch (e) {
    if (e.message.startsWith("发布失败")) throw e;
  }

  if (!handleSms && (await isPublishSmsVerificationVisible(page, 1000))) {
    console.log("  检测到短信验证码弹窗，交给独立短信验证步骤处理");
    return true;
  }

  const stillVisible = await publishBtn.isVisible().catch(() => false);
  if (stillVisible) {
    throw new Error("发布按钮仍在，发布未完成");
  }

  console.log("  ✅ 发布已提交（按钮已隐藏）");
  return true;
}

async function checkPublishSubmitted(page) {
  const deadline = Date.now() + scaledMs(35000);
  let lastReason = "等待发布提交结果";

  const publishBtn = page
    .locator(
      [
        'button:has-text("发布"):not(:has-text("定时")):not(:has-text("高清"))'
      ].join(", ")
    )
    .first();

  while (Date.now() < deadline) {
    const url = page.url();
    if (/\/content\/manage\b/.test(url)) {
      checkOk("发布提交校验通过 (已进入作品管理页)");
      return;
    }

    const bodyText = await page
      .locator("body")
      .innerText({ timeout: scaledMs(1000) })
      .catch(() => "");
    const compactText = bodyText.replace(/\s+/g, " ").trim();

    const failureMatch = compactText.match(
      /(发布失败|发布错误|提交失败|提交错误|系统异常|网络异常|内容违规|操作失败)[^。！？\n]{0,80}/
    );
    if (failureMatch) {
      throw new Error(`发布提交校验失败：${failureMatch[0]}`);
    }

    if (/发布成功|提交成功|发布已提交/.test(compactText)) {
      checkOk("发布提交校验通过 (检测到成功提示)");
      return;
    }

    const smsVisible = await page
      .locator("text=接收短信验证码")
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
    if (smsVisible) {
      throw new Error("发布提交校验失败：仍停留在短信验证码弹窗");
    }

    const buttonVisible = await publishBtn
      .isVisible({ timeout: 500 })
      .catch(() => false);
    const buttonDisabled = buttonVisible
      ? await publishBtn.isDisabled().catch(() => false)
      : false;
    const onPostPage = /\/content\/post\/(video|image)\b/.test(url);
    const formVisible = await page
      .locator("text=作品描述")
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);

    if (buttonVisible) {
      lastReason = buttonDisabled
        ? "发布按钮仍在但已禁用"
        : "发布按钮仍可见，发布未完成";
    } else if (!onPostPage || !formVisible) {
      checkOk("发布提交校验通过 (发布表单已离开或按钮已隐藏)");
      return;
    } else {
      lastReason = "仍停留在发布表单，等待跳转或成功提示";
    }

    await page.waitForTimeout(scaledMs(1000));
  }

  throw new Error(`发布提交校验超时：${lastReason}`);
}

// ===== 单步校验函数：每个填写步骤完成后立即调用，失败则抛错 =====

async function readVideoUploadState(page) {
  return page
    .evaluate(() => {
      const normalizeText = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const srcOf = (el) =>
        String(el.currentSrc || el.src || el.getAttribute("src") || "");
      const allText = normalizeText(document.body?.innerText || "");
      const uploadEmptyVisible = Array.from(
        document.querySelectorAll("p, div, span")
      ).some((el) => {
        if (!isVisible(el)) return false;
        const text = normalizeText(el.textContent);
        return (
          text.includes("点击上传") &&
          text.includes("或直接将视频文件拖入此区域")
        );
      });
      const failureMatch = allText.match(
        /(视频上传失败|上传视频失败|上传失败|上传出错|上传异常|上传错误|文件上传失败|视频处理失败|转码失败|解析失败|格式不支持|不支持该格式|视频大小超过|文件大小超过|视频时长不符合|上传超时)[^。！？\n]{0,80}/
      );
      const videos = Array.from(document.querySelectorAll("video"))
        .filter(isVisible)
        .map(srcOf)
        .filter(Boolean);
      const previewImages = Array.from(document.querySelectorAll("img"))
        .filter(isVisible)
        .map(srcOf)
        .filter((src) =>
          /^(blob:)|creator-media-private\.douyin\.com|video-cn\.douyin\.com/.test(src)
        );
      const generatingCover = /Ai智能推荐封面生成中|AI智能推荐封面生成中|生成中/.test(
        allText
      );

      return {
        hasVideoPreview: videos.length > 0,
        hasGeneratedPreviewImage: previewImages.length > 0,
        uploadEmptyVisible,
        failureText: failureMatch ? failureMatch[0] : "",
        generatingCover
      };
    })
    .catch((error) => ({
      hasVideoPreview: false,
      hasGeneratedPreviewImage: false,
      uploadEmptyVisible: false,
      failureText: "",
      generatingCover: false,
      readError: error?.message || String(error)
    }));
}

async function checkVideoUploaded(page, options = {}) {
  const timeoutMs = scaledMs(options.timeoutMs || 120000);
  const deadline = Date.now() + timeoutMs;
  let lastState = null;

  while (Date.now() < deadline) {
    const state = await readVideoUploadState(page);
    lastState = state;

    if (state.failureText) {
      throw new Error(`视频素材校验失败：${state.failureText}`);
    }
    if (state.hasVideoPreview) {
      checkOk("视频素材校验通过 (video preview)");
      return;
    }
    if (state.hasGeneratedPreviewImage && !state.uploadEmptyVisible) {
      checkOk("视频素材校验通过 (generated preview image)");
      return;
    }
    if (state.uploadEmptyVisible && !state.generatingCover) {
      throw new Error(
        "视频素材校验失败：页面仍显示上传入口，未检测到视频预览"
      );
    }

    await page.waitForTimeout(scaledMs(1000));
  }

  const stateNote = lastState
    ? `（uploadEmptyVisible=${lastState.uploadEmptyVisible}, hasVideoPreview=${lastState.hasVideoPreview}, hasGeneratedPreviewImage=${lastState.hasGeneratedPreviewImage}）`
    : "";
  throw new Error(`视频素材校验失败：等待视频预览超时${stateNote}`);
}

async function checkImagesUploaded(page, expectedCount) {
  if (!expectedCount || expectedCount <= 0) {
    checkOk("图文素材校验通过 (无图片)");
    return;
  }

  for (let attempt = 0; attempt < 15; attempt++) {
    // 页面编辑区"已添加X张图片" + 旁边的"继续添加"按钮，双重确认区域正确
    const countText = await page
      .locator("text=/已添加(\\d+)张图片/")
      .first()
      .textContent()
      .catch(() => "");
    const nearby = await page
      .locator('button:has-text("继续添加")')
      .first()
      .isVisible()
      .catch(() => false);
    const count = (() => {
      const m = countText.match(/已添加(\d+)张图片/);
      return m && nearby ? parseInt(m[1], 10) : 0;
    })();

    if (count >= expectedCount) {
      checkOk(`图文素材校验通过 (${count}张)`);
      return;
    }
    await page.waitForTimeout(2000);
  }

  throw new Error(
    `图文素材校验失败：期望 ${expectedCount} 张，未匹配到足够图片`
  );
}

async function checkCoverSelected(page) {
  // 封面被选中后，槽位文案从"选择封面"变为"编辑封面"（文本在 hover-show 层中，display:none 但仍可读）
  const titleEls = page.locator('[class*="coverControl"] [class*="title"]');
  const count = await titleEls.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const text = await titleEls
      .nth(i)
      .innerText()
      .catch(() => "");
    if (text.includes("编辑封面")) {
      checkOk("封面选择校验通过");
      return;
    }
  }
  // 兜底：检查推荐封面项是否有 selected 标记
  const selectedItem = page
    .locator(
      '[class*="recommendCoverContainer"] [class*="recommendCover"][class*="selected"]'
    )
    .first();
  if (await selectedItem.isVisible({ timeout: 2000 }).catch(() => false)) {
    checkOk("封面选择校验通过 (selected class)");
    return;
  }
  // 再兜底：coverControl 内 filter 元素有 hover-show 类 → 封面已应用
  const filterEls = page.locator(
    '[class*="coverControl"] [class*="filter"][class*="hover-show"]'
  );
  if ((await filterEls.count().catch(() => 0)) > 0) {
    checkOk("封面选择校验通过 (hover-show class)");
    return;
  }
  throw new Error("封面选择校验失败：未检测到封面已应用的标记");
}

async function checkTitleFilled(page, expectedTitle) {
  if (!expectedTitle) return;
  const titleInput = page
    .locator('input[placeholder*="标题"], input[placeholder*="作品标题"]')
    .first();
  const actual = (await titleInput.inputValue().catch(() => "")).trim();
  if (actual) {
    checkOk("标题校验通过");
    return;
  }
  throw new Error(`标题校验失败：输入框为空，期望: ${expectedTitle}`);
}

async function checkBodyFilled(page, expectedBody) {
  if (!expectedBody) return;
  const editor = page.locator('[contenteditable="true"]').first();
  const text = (await editor.textContent().catch(() => "")).trim();
  // 编辑器内通过 Enter 换行会插入零宽空格，替换为空格后再比较（与 \n 行为一致）
  const clean = (s) =>
    s
      .replace(/[​‌‍﻿]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  if (text && clean(text).includes(clean(expectedBody.slice(0, 20)))) {
    checkOk("正文校验通过");
    return;
  }
  throw new Error(`正文校验失败：编辑器内未找到期望正文 "${expectedBody}"`);
}

async function checkHashtagsSet(page, expectedHashtags) {
  if (!expectedHashtags || expectedHashtags.length === 0) return;

  const topicEls = page.locator(
    '[data-mention="#"] span, [class*="topic"], [class*="hashtag"]'
  );
  const topicCount = await topicEls.count().catch(() => 0);
  const topicTexts = [];
  for (let i = 0; i < topicCount; i++) {
    const t = (
      await topicEls
        .nth(i)
        .textContent()
        .catch(() => "")
    ).trim();
    if (t) topicTexts.push(t);
  }

  let matchedCount = 0;
  const unmatched = [];
  for (const expected of expectedHashtags) {
    if (topicTexts.some((t) => topicTextMatches(t, expected))) {
      matchedCount++;
    } else {
      unmatched.push(expected);
    }
  }

  if (matchedCount === expectedHashtags.length) {
    checkOk(`话题标签校验通过 (${matchedCount}个)`);
    return;
  }
  throw new Error(
    `话题标签校验失败：${matchedCount}/${expectedHashtags.length} 匹配` +
      `，缺失: ${unmatched.join(", ")}` +
      `，实际: ${topicTexts.join(", ") || "(空)"}`
  );
}

async function checkScheduleSet(page) {
  const dateInput = page
    .locator('.semi-datepicker input, input[placeholder*="日期"]')
    .first();
  const actual = (await dateInput.inputValue().catch(() => "")).trim();
  if (actual) {
    checkOk(`定时发布校验通过 (${actual})`);
    return;
  }
  throw new Error("定时发布校验失败：日期选择器为空");
}

async function checkProductLinkSet(page, expectedProductTitle = "") {
  const issues = [];

  const anchor = page.locator('#douyin_creator_pc_anchor_jump').first();
  const anchorOrPage = (await anchor.isVisible({ timeout: 500 }).catch(() => false))
    ? anchor
    : page;

  // 1. 检查购物车下拉框是否已选中（通过 .semi-select-selection-text 内文本或 select-dropdown-option-img）
  const cartSelectors = [
    '.semi-select-selection-text:has-text("购物车")',
    '[class*="select-dropdown-option"]:has-text("购物车")',
    '[class*="selectText"]:has-text("购物车")',
    '[class*="cart-part"]',
    '[class*="cart-goodlist"]',
    '.cart-container'
  ];
  let cartSelected = false;
  for (const sel of cartSelectors) {
    if (
      await anchorOrPage
        .locator(sel)
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false)
    ) {
      cartSelected = true;
      break;
    }
  }
  if (!cartSelected) issues.push("购物车未选中");

  // 2. 检查是否已添加商品（完成后输入框会被清空，商品出现在 cart-container 中）
  const productAddedSelectors = [
    '[class*="cart-item"]',
    '[class*="cart-container"] [class*="item"]',
    '[class*="anchor"] [class*="card"]',
    "text=已添加商品"
  ];
  let productAdded = false;
  let productText = "";
  for (const sel of productAddedSelectors) {
    const product = anchorOrPage.locator(sel).first();
    if (await product.isVisible({ timeout: 1000 }).catch(() => false)) {
      productAdded = true;
      productText = (await product.textContent().catch(() => "")).trim();
      break;
    }
  }
  if (!productAdded) {
    issues.push("未检测到已添加的商品");
  }

  const expectedTitle = String(expectedProductTitle || "").trim();
  if (productAdded && expectedTitle && productText && !/^已添加商品$/.test(productText)) {
    const normalizedActual = productText.replace(/\s+/g, "");
    const normalizedExpected = expectedTitle.replace(/\s+/g, "");
    if (
      normalizedExpected &&
      !normalizedActual.includes(normalizedExpected) &&
      !normalizedExpected.includes(normalizedActual)
    ) {
      issues.push(`商品标题未匹配：期望包含 "${expectedTitle}"，实际 "${productText.slice(0, 80)}"`);
    }
  }

  const linkInput = anchorOrPage.locator('input[placeholder*="粘贴商品"], input[placeholder*="链接"]').first();
  if (await linkInput.isVisible({ timeout: 500 }).catch(() => false)) {
    const linkValue = (await linkInput.inputValue().catch(() => "")).trim();
    if (linkValue) {
      issues.push("商品链接仍停留在输入框，商品尚未确认添加");
    }
  }

  // 3. 检查编辑弹窗是否已关闭
  const finishBtn = page.locator('.semi-modal-content button:has-text("完成编辑")').first();
  if (await finishBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    issues.push("商品编辑弹窗未关闭（完成编辑按钮仍可见）");
  }

  if (issues.length === 0) {
    checkOk("购物车链接校验通过");
    checkOk("商品编辑校验通过");
  } else {
    throw new Error(`购物车链接校验失败：${issues.join("; ")}`);
  }
}

async function checkProductLinkAbsent(page) {
  const issues = [];
  const cartSelected = await page
    .locator(
      [
        '.semi-select-selection-text:has-text("购物车")',
        '[class*="selectText"]:has-text("购物车")'
      ].join(", ")
    )
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (cartSelected) issues.push("页面仍选中购物车");

  const productAddedSelectors = [
    '[class*="cart-item"]',
    '[class*="cart-container"] [class*="item"]',
    '[class*="anchor"] [class*="card"]',
    "text=已添加商品"
  ];
  for (const selector of productAddedSelectors) {
    if (await page.locator(selector).first().isVisible({ timeout: 300 }).catch(() => false)) {
      issues.push(`页面仍存在商品挂载标记 (${selector})`);
      break;
    }
  }

  const linkInputs = page.locator('input[placeholder*="粘贴商品"], input[placeholder*="商品链接"]');
  const inputCount = await linkInputs.count().catch(() => 0);
  for (let i = 0; i < inputCount; i += 1) {
    const input = linkInputs.nth(i);
    if (!(await input.isVisible().catch(() => false))) continue;
    const value = (await input.inputValue().catch(() => "")).trim();
    if (value) {
      issues.push("商品链接输入框存在残留值");
      break;
    }
  }

  const finishBtn = page.locator('.semi-modal-content button:has-text("完成编辑")').first();
  if (await finishBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    issues.push("商品编辑弹窗仍打开");
  }

  if (issues.length > 0) {
    throw new Error(`未配置购物车校验失败：${issues.join("; ")}`);
  }
  checkOk("未配置购物车校验通过");
}

async function getFormSectionByTitle(page, title) {
  const section = page
    .locator(`xpath=//*[normalize-space()="${title}"]/ancestor::*[.//*[contains(@class,"selectBox")] or .//*[contains(@class,"semi-select")] or .//input or .//label][1]`)
    .first();
  if (await section.isVisible({ timeout: 1000 }).catch(() => false)) {
    return section;
  }
  return page.locator(`section:has-text("${title}"), div:has-text("${title}")`).first();
}

async function checkSelfDeclarationSet(page, isAiContent) {
  const targetLabel = isAiContent ? "内容由AI生成" : "无需添加自主声明";
  const section = await getFormSectionByTitle(page, "自主声明");
  if (!(await section.isVisible({ timeout: 2000 }).catch(() => false))) {
    checkOk("自主声明校验通过 (未找到声明区域)");
    return;
  }
  const currentText = (
    await section
      .locator('[class*="selectText"], .semi-select-selection-text')
      .first()
      .textContent()
      .catch(() => "")
  ).trim();
  if (currentText && currentText.includes(targetLabel)) {
    checkOk(`自主声明校验通过 (${targetLabel})`);
    return;
  }
  throw new Error(
    `自主声明校验失败：期望 "${targetLabel}"，实际 "${currentText || "(空)"}"`
  );
}

async function checkMusicSelected(page) {
  // 配乐区域有两个"选择音乐"文本：标题区 title-content-oaqcSp 和操作区 action-Q1y01k
  // 选中后标题区保持不变，操作区文字会变成歌曲名
  const actionSpan = page
    .locator('span[class*="action"]:has-text("选择音乐")')
    .first();
  const stillDefault = await actionSpan
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  if (!stillDefault) {
    checkOk("配乐校验通过");
    return;
  }

  // 操作区仍显示"选择音乐"，检查默认占位文字是否已消失
  const placeholder = page.locator("text=点击添加合适作品风格音乐").first();
  const placeholderGone = !(await placeholder
    .isVisible({ timeout: 1000 })
    .catch(() => false));

  if (placeholderGone) {
    checkOk("配乐校验通过 (占位文字已消失)");
    return;
  }

  throw new Error("配乐校验失败：未检测到已选配乐");
}

module.exports = {
  scaledMs,
  waitForPageSettled,
  calibrateNetworkSpeed,
  getCalibratedMultiplier,
  ensureLoggedIn,
  closeCreatorGuides,
  scrollPublishFormToBottom,
  optimizePublishPageForViewing,
  clickPublishButton,
  isPublishSmsVerificationVisible,
  handlePublishSmsVerification,
  checkPublishSmsVerificationCompleted,
  checkPublishSubmitted,
  checkVideoUploaded,
  checkImagesUploaded,
  checkCoverSelected,
  checkTitleFilled,
  checkBodyFilled,
  checkHashtagsSet,
  checkScheduleSet,
  checkProductLinkSet,
  checkProductLinkAbsent,
  checkSelfDeclarationSet,
  checkMusicSelected
};
