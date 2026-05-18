const {
  TARGET_URL,
  LOGIN_VERIFY_METHOD,
  LOGIN_WAIT_TIMEOUT_MS,
  LOGIN_PAGE_GOTO_TIMEOUT_MS,
  LOGIN_REMIND_INTERVAL_MS,
  SMS_REMIND_INTERVAL_MS
} = require("./env");
const { sendAlertEmail } = require("./mail");
const { captureLoginQrScreenshot, hasVisibleQr } = require("./qr");
const {
  isReceiveOtpPanelVisible,
  isSmsVerifyPanelVisible,
  handleFaceVerificationIfPresent,
  handleSmsVerificationIfPresent,
  handleReceiveSmsCodeIfPresent,
  readReceiveOtpInfoFromPage,
  readSmsVerifyInfoFromPage
} = require("./verification");
const { loginStageHintByAccount } = require("./state");

async function isLoggedInAtTarget(page) {
  const inTargetPage = page.url().includes("/creator-micro/data-center/content");
  const hasPostListTab = await page
    .locator("text=投稿列表")
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);
  return inTargetPage && hasPostListTab;
}

async function isVerificationUiVisible(page) {
  const checks = [
    page.locator("text=扫码登录").first(),
    page.locator("text=身份验证").first(),
    page.locator("text=手机刷脸验证").first(),
    page.locator("text=发送短信验证").first(),
    page.locator("text=接收短信验证码").first()
  ];
  for (const locator of checks) {
    if (await locator.isVisible({ timeout: 400 }).catch(() => false)) {
      return true;
    }
  }
  if (await hasVisibleQr(page).catch(() => false)) {
    return true;
  }
  return false;
}

async function detectLoginStep(page) {
  if (await isLoggedInAtTarget(page)) return "logged_in";
  if (await isReceiveOtpPanelVisible(page)) return "receive_sms_code_panel";
  if (await isSmsVerifyPanelVisible(page)) return "sms_panel";

  const identityVisible = await page
    .locator("text=身份验证")
    .first()
    .isVisible({ timeout: 300 })
    .catch(() => false);
  if (identityVisible) return "identity_verify";

  const faceTitleVisible = await page
    .locator("text=手机刷脸验证")
    .first()
    .isVisible({ timeout: 300 })
    .catch(() => false);
  if (faceTitleVisible) return "face_verify";

  const qrTitleVisible = await page
    .locator("text=扫码登录")
    .first()
    .isVisible({ timeout: 300 })
    .catch(() => false);
  if (qrTitleVisible) return "qr_login";

  if (await hasVisibleQr(page).catch(() => false)) return "qr_login";
  return "unknown";
}

async function shouldRetryTargetAfterLogin(page) {
  const url = page.url() || "";
  if (!url.includes("creator.douyin.com")) return false;
  if (url.includes("/creator-micro/data-center/content")) return false;
  if (await isVerificationUiVisible(page)) return false;
  return true;
}

async function clickIfVisible(locator, timeout = 3500) {
  if (
    await locator
      .first()
      .isVisible({ timeout })
      .catch(() => false)
  ) {
    try {
      await locator.first().click({ timeout: Math.min(timeout, 4000) });
    } catch {
      await locator.first().click({ force: true, timeout: 3000 });
    }
    return true;
  }
  return false;
}

async function notifyLoginRequired(page, paths, accountName, reason) {
  const screenshotPath = await captureLoginQrScreenshot(
    page,
    paths,
    accountName
  );
  await sendAlertEmail({ accountName, screenshotPath, reason }).catch((error) => {
    console.error(`账号 [${accountName}] 邮件发送失败:`, error.message || error);
  });
}

async function resendLoginReminderByStage(page, paths, accountName, baseReason) {
  const stageHint = loginStageHintByAccount.get(accountName) || "";

  if (stageHint.includes("手机刷脸验证")) {
    const { captureFaceQrScreenshot } = require("./qr");
    const { sendFaceVerifyEmail } = require("./mail");
    const screenshotPath = await captureFaceQrScreenshot(page, paths, accountName);
    await sendFaceVerifyEmail({
      accountName,
      screenshotPath,
      reason: `${baseReason}（刷脸二维码可能过期，定时重发）`
    }).catch((error) => {
      console.error(`账号 [${accountName}] 刷脸重发邮件失败:`, error.message || error);
    });
    return;
  }

  if (stageHint.includes("接收短信验证码")) {
    const { sendReceiveOtpEmail } = require("./mail");
    const { maskedPhone } = await readReceiveOtpInfoFromPage(page);
    await sendReceiveOtpEmail({
      accountName,
      maskedPhone,
      reason: `${baseReason}（仍在等待用户填写验证码）`
    }).catch((error) => {
      console.error(`账号 [${accountName}] 接收验证码重发邮件失败:`, error.message || error);
    });
    return;
  }

  if (stageHint.includes("短信验证")) {
    const { sendSmsVerifyEmail } = require("./mail");
    const { maskedPhone, smsContent, smsTarget } = await readSmsVerifyInfoFromPage(page);
    await sendSmsVerifyEmail({
      accountName,
      maskedPhone,
      smsContent,
      smsTarget
    }).catch((error) => {
      console.error(`账号 [${accountName}] 短信验证重发邮件失败:`, error.message || error);
    });
    return;
  }

  const resendReason = stageHint
    ? `${baseReason}（${stageHint}，二维码可能过期，定时重发）`
    : `${baseReason}（二维码可能过期，定时重发）`;
  await notifyLoginRequired(page, paths, accountName, resendReason);
}

async function waitForManualLoginFlow(
  page,
  paths,
  accountName,
  reason,
  timeoutMs = LOGIN_WAIT_TIMEOUT_MS,
  resendEveryMs = LOGIN_REMIND_INTERVAL_MS,
  options = {}
) {
  const enableReminders = options.enableReminders !== false;
  const sendNotifications = options.sendNotifications !== false;
  const onLoggedIn = typeof options.onLoggedIn === "function" ? options.onLoggedIn : null;
  console.log(`账号 [${accountName}] 等待手动完成登录（扫码 + 验证）。`);
  const smsVerifyMode = LOGIN_VERIFY_METHOD === "sms";
  const receiveSmsCodeMode = LOGIN_VERIFY_METHOD === "receive_sms_code";
  let lastStep = "";
  const start = Date.now();
  let lastGeneralNotifyAt = Date.now();
  let lastSmsNotifyAt = Date.now();
  let lastRetryToTargetAt = 0;
  while (Date.now() - start < timeoutMs) {
    const step = await detectLoginStep(page);
    if (step !== lastStep) {
      const stageMap = {
        logged_in: "当前处于已登录阶段",
        sms_panel: "当前处于短信验证阶段",
        receive_sms_code_panel: "当前处于接收短信验证码阶段",
        identity_verify: "当前处于身份验证选择阶段",
        face_verify: "当前处于手机刷脸验证阶段",
        qr_login: "当前处于扫码登录阶段",
        unknown: "当前阶段未知，等待页面稳定"
      };
      const hint = stageMap[step] || stageMap.unknown;
      loginStageHintByAccount.set(accountName, hint);
      console.log(`账号 [${accountName}] 登录阶段识别: ${hint}`);
      lastStep = step;
    }

    if (step === "logged_in") {
      if (onLoggedIn) {
        await onLoggedIn(page);
      }
      return;
    }

    if (smsVerifyMode) {
      if (step === "identity_verify" || step === "sms_panel") {
        await handleSmsVerificationIfPresent(page, paths, accountName, {
          alwaysTrySmsEntry: true,
          autoClickSentButton: true,
          sendNotifications
        });
      }
    } else if (receiveSmsCodeMode) {
      if (step === "identity_verify" || step === "receive_sms_code_panel") {
        await handleReceiveSmsCodeIfPresent(page, paths, accountName, {
          alwaysTryReceiveEntry: true,
          sendNotifications
        });
      }
    } else {
      await handleFaceVerificationIfPresent(page, paths, accountName, {
        skipFaceVerify: false,
        sendNotifications
      });
      await handleSmsVerificationIfPresent(page, paths, accountName, {
        alwaysTrySmsEntry: false,
        autoClickSentButton: false,
        sendNotifications
      });
    }

    if (await shouldRetryTargetAfterLogin(page)) {
      const now = Date.now();
      if (now - lastRetryToTargetAt >= 2500) {
        lastRetryToTargetAt = now;
        console.log(
          `账号 [${accountName}] 检测到验证流程已结束，尝试重新进入目标导出页。`
        );
        await page
          .goto(TARGET_URL, { waitUntil: "domcontentloaded" })
          .catch(() => {});
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(800);
        if (await isLoggedInAtTarget(page)) {
          if (onLoggedIn) {
            await onLoggedIn(page);
          }
          return;
        }
      }
    }

    const now = Date.now();
    const inSmsNotifyStage = step === "sms_panel";
    const inReceiveOtpStage = step === "receive_sms_code_panel";
    const smsNotifyIntervalMs = SMS_REMIND_INTERVAL_MS;
    const reachedSmsNotifyTime =
      inSmsNotifyStage && now - lastSmsNotifyAt >= smsNotifyIntervalMs;
    const reachedGeneralNotifyTime =
      !inSmsNotifyStage &&
      !inReceiveOtpStage &&
      now - lastGeneralNotifyAt >= resendEveryMs;
    if (enableReminders && (reachedSmsNotifyTime || reachedGeneralNotifyTime)) {
      console.log(`账号 [${accountName}] 仍未登录，重新截图并发送提醒邮件。`);
      await resendLoginReminderByStage(page, paths, accountName, reason);
      if (inSmsNotifyStage) {
        lastSmsNotifyAt = now;
      } else {
        lastGeneralNotifyAt = now;
      }
    }
    await page.waitForTimeout(1200);
  }
  throw new Error(
    `账号 [${accountName}] 等待登录超时（${Math.floor(timeoutMs / 60000)} 分钟）。`
  );
}

async function openTargetAndEnsureLogin(page, paths, accountName, options) {
  const {
    hasStoredAuth,
    forceManualLogin,
    manualLoginReason,
    sendLoginAlerts = true,
    context = null,
    skipInitialNavigation = false,
  } = options;

  const trySaveAuth = async (reason) => {
    if (!context) return;
    if (trySaveAuth._done) return;
    try {
      const { saveAuth } = require("./exporter");
      const cookies = await context.cookies();
      if (!Array.isArray(cookies) || cookies.length === 0) return;
      let loggedIn = false;
      if (page && !page.isClosed()) {
        loggedIn = await isLoggedInAtTarget(page).catch(() => false);
      }
      if (!loggedIn) {
        console.log(
          `账号 [${accountName}] ${reason}，有 ${cookies.length} 个 cookie 但未登录，跳过保存。`
        );
        return;
      }
      console.log(`账号 [${accountName}] ${reason}，立即保存登录态。`);
      await saveAuth(context, paths, accountName);
      trySaveAuth._done = true;
    } catch (error) {
      console.warn(
        `账号 [${accountName}] ${reason} 保存登录态失败: ${error.message || error}`
      );
    }
  };
  trySaveAuth._done = false;

  if (!skipInitialNavigation) {
    await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: LOGIN_PAGE_GOTO_TIMEOUT_MS,
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1200);
  }

  if (forceManualLogin) {
    console.log(`账号 [${accountName}] 当前无有效登录态，需手动扫码并完成验证。`);
    const reason = manualLoginReason || "需要手动登录目标账号";
    if (sendLoginAlerts) {
      await notifyLoginRequired(page, paths, accountName, reason);
    }
    await waitForManualLoginFlow(
      page, paths, accountName, reason,
      LOGIN_WAIT_TIMEOUT_MS, LOGIN_REMIND_INTERVAL_MS,
      {
        enableReminders: sendLoginAlerts,
        sendNotifications: sendLoginAlerts,
        onLoggedIn: async () => { await trySaveAuth("检测到登录成功"); },
      }
    );
    await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: LOGIN_PAGE_GOTO_TIMEOUT_MS,
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(900);
    await trySaveAuth("登录流程结束");
    return;
  }

  if (await isLoggedInAtTarget(page)) {
    console.log(`账号 [${accountName}] 检测到已登录，复用本地会话。`);
    return;
  }

  const reason = hasStoredAuth
    ? "cookies/storageState 失效或已过期"
    : "本地 cookies/storageState 不存在";
  if (sendLoginAlerts) {
    await notifyLoginRequired(page, paths, accountName, reason);
  }
  await waitForManualLoginFlow(
    page, paths, accountName, reason,
    LOGIN_WAIT_TIMEOUT_MS, LOGIN_REMIND_INTERVAL_MS,
    {
      enableReminders: sendLoginAlerts,
      sendNotifications: sendLoginAlerts,
      onLoggedIn: async () => { await trySaveAuth("检测到登录成功"); },
    }
  );
  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: LOGIN_PAGE_GOTO_TIMEOUT_MS,
  });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);
  await trySaveAuth("登录流程结束");
}

module.exports = {
  isLoggedInAtTarget,
  isVerificationUiVisible,
  clickIfVisible,
  openTargetAndEnsureLogin,
  notifyLoginRequired,
  waitForManualLoginFlow,
};
