const {
  SMS_SENT_CLICK_INTERVAL_MS,
  OTP_RESEND_INTERVAL_MS,
  OTP_EMAIL_POLL_INTERVAL_MS
} = require("./env");
const {
  sendFaceVerifyEmail,
  sendSmsVerifyEmail,
  sendReceiveOtpEmail,
  fetchOtpCodeFromEmail
} = require("./mail");
const { captureFaceQrScreenshot } = require("./qr");
const {
  smsNotifySentByAccount,
  receiveOtpNotifySentByAccount,
  faceNotifySentByAccount,
  loginStageHintByAccount,
  lastSmsConfirmClickAtByAccount,
  otpRequestSinceByAccount,
  otpLastPollAtByAccount,
  otpLastAppliedByAccount,
  otpLastStatusLogAtByAccount,
  otpLastResendAtByAccount,
  otpReceiveWaitLoggedByAccount
} = require("./state");

async function readSmsVerifyInfoFromPage(page) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const phoneMatch = bodyText.match(/请使用手机号\s*([0-9*]+)\s*发送短信验证/);
  const smsContentMatch = bodyText.match(/编辑短信内容[:：]\s*([A-Za-z0-9]+)/);
  const smsTargetMatch = bodyText.match(/发送至[:：]\s*([0-9]+)/);

  return {
    maskedPhone: phoneMatch ? phoneMatch[1] : "",
    smsContent: smsContentMatch ? smsContentMatch[1] : "",
    smsTarget: smsTargetMatch ? smsTargetMatch[1] : ""
  };
}

async function readReceiveOtpInfoFromPage(page) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const phonePatterns = [
    /请使用手机号\s*([0-9*]+)\s*(?:接收|获取)短信验证码/,
    /短信已发送至\s*([0-9*]+)/
  ];
  let maskedPhone = "";
  for (const pattern of phonePatterns) {
    const match = bodyText.match(pattern);
    if (match && match[1]) {
      maskedPhone = match[1];
      break;
    }
  }
  return {
    maskedPhone
  };
}

async function clickSmsSentButtonIfNeeded(page, accountName) {
  const now = Date.now();
  const lastClickAt = lastSmsConfirmClickAtByAccount.get(accountName) || 0;
  if (now - lastClickAt < SMS_SENT_CLICK_INTERVAL_MS) {
    return false;
  }

  const clickedByDomExactText = await page
    .evaluate(() => {
      const normalize = (s) => String(s || "").replace(/\s+/g, "");
      const panels = Array.from(document.querySelectorAll("article"));
      for (const panel of panels) {
        const title = panel.querySelector("[class*='title']");
        if (!title || normalize(title.textContent) !== "发送短信验证") continue;
        const btns = Array.from(
          panel.querySelectorAll("[class*='btn'], [class*='primary']")
        );
        for (const btn of btns) {
          if (normalize(btn.textContent) !== "我已发送") continue;
          const el = /** @type {HTMLElement} */ (btn);
          el.click();
          return true;
        }
      }
      return false;
    })
    .catch(() => false);
  if (!clickedByDomExactText) {
    const sentBtnCandidates = [
      page
        .locator("article:has-text('发送短信验证') [class*='primary']")
        .filter({ hasText: /^我已发送$/ })
        .first(),
      page
        .locator("[class*='footer'] [class*='btn']")
        .filter({ hasText: /^我已发送$/ })
        .first(),
      page.getByText("我已发送", { exact: true }).first()
    ];
    let clicked = false;
    for (const btn of sentBtnCandidates) {
      const visible = await btn.isVisible({ timeout: 250 }).catch(() => false);
      if (!visible) continue;
      await btn.click().catch(() => {});
      clicked = true;
      break;
    }
    if (!clicked) return false;
  }

  lastSmsConfirmClickAtByAccount.set(accountName, now);
  console.log(`账号 [${accountName}] 已尝试点击“我已发送”。`);
  return true;
}

async function isSmsVerifyPanelVisible(page) {
  const markers = [
    page.locator("text=编辑短信内容").first(),
    page.locator("text=发送至").first(),
    page.getByText("我已发送", { exact: true }).first()
  ];
  for (const marker of markers) {
    if (await marker.isVisible({ timeout: 300 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function isReceiveOtpPanelVisible(page) {
  const hasReceiveTitle = await page
    .getByText("接收短信验证码", { exact: true })
    .first()
    .isVisible({ timeout: 200 })
    .catch(() => false);
  if (!hasReceiveTitle) {
    return false;
  }

  const markers = [
    page
      .locator("article:has-text('接收短信验证码') input[placeholder*='验证码']")
      .first(),
    page
      .locator(
        "[role='dialog']:has-text('接收短信验证码') input[placeholder*='验证码']"
      )
      .first()
  ];
  for (const marker of markers) {
    if (await marker.isVisible({ timeout: 250 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function fillReceiveOtpCodeAndSubmit(page, otpCode) {
  const inputCandidates = [
    page
      .locator("article:has-text('接收短信验证码') input[placeholder*='验证码']")
      .first(),
    page
      .locator(
        "[role='dialog']:has-text('接收短信验证码') input[placeholder*='验证码']"
      )
      .first()
  ];
  let filled = false;
  for (const input of inputCandidates) {
    const visible = await input.isVisible({ timeout: 250 }).catch(() => false);
    if (!visible) continue;
    await input.fill(otpCode).catch(() => {});
    filled = true;
    break;
  }
  if (!filled) return false;

  const buttonCandidates = [
    page
      .locator("article:has-text('接收短信验证码') [class*='primary']")
      .filter({ hasText: /(确认|提交|登录|验证|完成)/ })
      .first(),
    page
      .locator("[role='dialog']:has-text('接收短信验证码') button")
      .filter({ hasText: /(确认|提交|登录|验证|完成)/ })
      .first(),
    page.getByText(/确认|提交|登录|验证|完成/).first()
  ];
  for (const button of buttonCandidates) {
    const visible = await button.isVisible({ timeout: 250 }).catch(() => false);
    if (!visible) continue;
    await button.click().catch(() => {});
    await page.waitForTimeout(500);
    return true;
  }
  return true;
}

async function clickReceiveOtpResendButton(page) {
  const clickedByDom = await page
    .evaluate(() => {
      const normalize = (s) => String(s || "").replace(/\s+/g, "");
      const dispatchClick = (el) => {
        const events = [
          "pointerover",
          "pointerenter",
          "mouseover",
          "mouseenter",
          "pointerdown",
          "mousedown",
          "pointerup",
          "mouseup",
          "click"
        ];
        for (const type of events) {
          el.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window
            })
          );
        }
      };
      const panels = Array.from(document.querySelectorAll("article"));
      for (const panel of panels) {
        const title = panel.querySelector("[class*='title']");
        if (!title || normalize(title.textContent) !== "接收短信验证码") continue;
        const input = panel.querySelector("input[placeholder*='验证码']");
        if (!input) continue;

        // 优先点击验证码输入框同一行的“重新发送”按钮，避免误点同名元素。
        const inputRow =
          input.closest("[class*='button_input']") ||
          input.closest("[class*='input']") ||
          panel;
        const rowResend = inputRow.querySelector(
          "span[class*='button_text'], div[class*='button_text'], span[tabindex='0'], div[tabindex='0']"
        );
        if (rowResend && /重新发送/.test(normalize(rowResend.textContent))) {
          const style = window.getComputedStyle(rowResend);
          if (!style || style.pointerEvents !== "none") {
            const el = /** @type {HTMLElement} */ (rowResend);
            el.click();
            dispatchClick(el);
            return true;
          }
        }

        const resendCandidates = Array.from(
          panel.querySelectorAll("[class*='button_text'], span, div")
        );
        for (const node of resendCandidates) {
          if (!/重新发送/.test(normalize(node.textContent))) continue;
          const style = window.getComputedStyle(node);
          if (style && style.pointerEvents === "none") continue;
          const el = /** @type {HTMLElement} */ (node);
          el.click();
          dispatchClick(el);
          return true;
        }
      }
      return false;
    })
    .catch(() => false);
  if (clickedByDom) {
    await page.waitForTimeout(400);
    return true;
  }

  const candidates = [
    page
      .locator(
        "article:has-text('接收短信验证码') input[placeholder*='验证码']"
      )
      .locator("xpath=ancestor::*[contains(@class,'button_input')][1]")
      .locator("span[class*='button_text'], div[class*='button_text']")
      .filter({ hasText: /重新发送/ })
      .first(),
    page
      .locator(
        "article:has-text('接收短信验证码') span[class*='button_text']:has-text('重新发送')"
      )
      .first(),
    page
      .locator("[role='dialog']:has-text('接收短信验证码') span[class*='button_text']")
      .filter({ hasText: /^重新发送$/ })
      .first(),
    page
      .locator("article:has-text('接收短信验证码') div:has-text('重新发送')")
      .last(),
    page
      .locator("[role='dialog']:has-text('接收短信验证码') div:has-text('重新发送')")
      .last(),
    page
      .locator("article:has-text('接收短信验证码')")
      .getByText("重新发送", { exact: true })
      .first(),
    page
      .locator("[role='dialog']:has-text('接收短信验证码')")
      .getByText("重新发送", { exact: true })
      .first(),
    page.getByText("重新发送", { exact: true }).first()
  ];
  for (const node of candidates) {
    const visible = await node.isVisible({ timeout: 250 }).catch(() => false);
    if (!visible) continue;
    await node.click({ force: true }).catch(() => {});
    await node.dispatchEvent("click").catch(() => {});
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

async function hasReceiveOtpResendButton(page) {
  const panelCandidates = [
    page.locator("article:has-text('接收短信验证码')").first(),
    page.locator("[role='dialog']:has-text('接收短信验证码')").first()
  ];
  for (const panel of panelCandidates) {
    const panelVisible = await panel.isVisible({ timeout: 200 }).catch(() => false);
    if (!panelVisible) continue;
    const resendInPanel = panel
      .locator("span[class*='button_text'], div[class*='button_text'], span, div")
      .filter({ hasText: /重新发送/ })
      .first();
    if (await resendInPanel.isVisible({ timeout: 200 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function clickVerifyEntryByText(page, targetText) {
  const clickedByDomExactText = await page
    .evaluate((target) => {
      const normalize = (s) => String(s || "").replace(/\s+/g, "");
      const panel = document.querySelector("[id*='uc-second-verify']");
      if (!panel) return false;

      const items = Array.from(
        panel.querySelectorAll("[class*='list_item'], [class*='list-item']")
      );
      for (const item of items) {
        if (normalize(item.textContent) !== target) continue;
        const el = /** @type {HTMLElement} */ (item);
        el.click();
        return true;
      }
      return false;
    }, targetText)
    .catch(() => false);
  if (clickedByDomExactText) {
    await page.waitForTimeout(500);
    return true;
  }

  const entryCandidates = [
    page.locator("[id*='uc-second-verify'] [class*='list_item']").first(),
    page
      .locator("[role='dialog']")
      .filter({ hasText: "身份验证" })
      .last()
      .getByText(targetText, { exact: true })
      .first(),
    page
      .locator(`[id*='uc-second-verify'] div:has-text('${targetText}')`)
      .last(),
    page.getByText(targetText, { exact: true }).first()
  ];

  for (const entry of entryCandidates) {
    const visible = await entry.isVisible({ timeout: 400 }).catch(() => false);
    if (!visible) continue;
    const txt = await entry.textContent().catch(() => "");
    if (txt && String(txt).replace(/\s+/g, "") !== targetText) continue;
    await entry.click().catch(() => {});
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

async function clickSmsVerifyEntry(page) {
  return clickVerifyEntryByText(page, "发送短信验证");
}

async function clickReceiveOtpEntry(page) {
  return clickVerifyEntryByText(page, "接收短信验证码");
}

async function handleFaceVerificationIfPresent(page, paths, accountName, options = {}) {
  const { skipFaceVerify = false } = options;
  if (skipFaceVerify) {
    return false;
  }

  const identityVisible = await page
    .locator("text=身份验证")
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  if (identityVisible) {
    const faceEntry = page.getByText("手机刷脸验证").first();
    const faceEntryVisible = await faceEntry
      .isVisible({ timeout: 600 })
      .catch(() => false);
    if (faceEntryVisible) {
      await faceEntry.click().catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  const faceTitleVisible = await page
    .locator("text=手机刷脸验证")
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  if (!faceTitleVisible) {
    return false;
  }

  loginStageHintByAccount.set(accountName, "当前处于手机刷脸验证阶段");
  if (faceNotifySentByAccount.has(accountName)) {
    return true;
  }

  const screenshotPath = await captureFaceQrScreenshot(page, paths, accountName);
  await sendFaceVerifyEmail({
    accountName,
    screenshotPath,
    reason: "检测到手机刷脸验证弹窗"
  }).catch((error) => {
    console.error(
      `账号 [${accountName}] 发送刷脸验证邮件失败:`,
      error.message || error
    );
  });
  faceNotifySentByAccount.add(accountName);
  return true;
}

async function handleSmsVerificationIfPresent(page, paths, accountName, options = {}) {
  const { alwaysTrySmsEntry = false, autoClickSentButton = false } = options;
  const identityVisible = await page
    .locator("text=身份验证")
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  let smsPanelVisible = await isSmsVerifyPanelVisible(page);
  if (!smsPanelVisible && !identityVisible) {
    return false;
  }

  if (!smsPanelVisible && identityVisible) {
    const clicked = await clickSmsVerifyEntry(page);
    if (!clicked && !alwaysTrySmsEntry) {
      const hasFaceEntry = await page
        .getByText("手机刷脸验证")
        .first()
        .isVisible({ timeout: 400 })
        .catch(() => false);
      if (hasFaceEntry) {
        return false;
      }
    }
    smsPanelVisible = await isSmsVerifyPanelVisible(page);
  }

  if (!smsPanelVisible) {
    return false;
  }

  loginStageHintByAccount.set(accountName, "当前处于短信验证阶段");
  const { maskedPhone, smsContent, smsTarget } = await readSmsVerifyInfoFromPage(page);

  const notifyKey = `${accountName}:${maskedPhone}:${smsContent}:${smsTarget}`;
  if (!smsNotifySentByAccount.has(notifyKey)) {
    await sendSmsVerifyEmail({
      accountName,
      maskedPhone,
      smsContent,
      smsTarget
    }).catch((error) => {
      console.error(
        `账号 [${accountName}] 发送短信验证邮件失败:`,
        error.message || error
      );
    });

    smsNotifySentByAccount.add(notifyKey);
  }

  if (autoClickSentButton) {
    await clickSmsSentButtonIfNeeded(page, accountName);
  }
  return true;
}

async function handleReceiveSmsCodeIfPresent(page, paths, accountName, options = {}) {
  const { alwaysTryReceiveEntry = false } = options;
  const identityVisible = await page
    .locator("text=身份验证")
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  let panelVisible = await isReceiveOtpPanelVisible(page);
  if (!panelVisible && !identityVisible) {
    return false;
  }

  if (!panelVisible && identityVisible) {
    const clicked = await clickReceiveOtpEntry(page);
    if (!clicked && !alwaysTryReceiveEntry) {
      return false;
    }
    panelVisible = await isReceiveOtpPanelVisible(page);
  }
  if (!panelVisible) {
    return false;
  }

  loginStageHintByAccount.set(accountName, "当前处于接收短信验证码阶段");
  const { maskedPhone } = await readReceiveOtpInfoFromPage(page);
  const notifyKey = `${accountName}:${maskedPhone}`;
  if (!receiveOtpNotifySentByAccount.has(notifyKey)) {
    await sendReceiveOtpEmail({
      accountName,
      maskedPhone,
      reason: "首次进入接收短信验证码阶段，请回复验证码"
    }).catch((error) => {
      console.error(
        `账号 [${accountName}] 首次发送接收验证码提醒邮件失败:`,
        error.message || error
      );
    });
    receiveOtpNotifySentByAccount.add(notifyKey);
    otpRequestSinceByAccount.set(accountName, Date.now());
    otpLastResendAtByAccount.set(accountName, Date.now());
    otpReceiveWaitLoggedByAccount.delete(accountName);
  }

  const now = Date.now();
  const lastResendAt = otpLastResendAtByAccount.get(accountName) || 0;
  if (now - lastResendAt >= OTP_RESEND_INTERVAL_MS) {
    otpLastResendAtByAccount.set(accountName, now);
    const hasResendButton = await hasReceiveOtpResendButton(page);
    if (!hasResendButton) {
      if (!otpReceiveWaitLoggedByAccount.has(accountName)) {
        console.log(
          `账号 [${accountName}] 接收验证码弹窗暂未出现“重新发送”按钮，跳过本轮邮件提醒。`
        );
        otpReceiveWaitLoggedByAccount.add(accountName);
      }
    } else {
      otpReceiveWaitLoggedByAccount.delete(accountName);
      const resent = await clickReceiveOtpResendButton(page);
      if (resent) {
        await sendReceiveOtpEmail({
          accountName,
          maskedPhone,
          reason: "已先点击“重新发送”，请回复最新验证码"
        }).catch((error) => {
          console.error(
            `账号 [${accountName}] 重发验证码后邮件提醒失败:`,
            error.message || error
          );
        });
        // 重试发送后刷新验证码邮件时间基准，后续仅比对这之后的新回复。
        otpRequestSinceByAccount.set(accountName, Date.now());
        console.log(
          `账号 [${accountName}] 已先点击“重新发送”，再发送验证码回复邮件提醒。`
        );
      }
    }
  }

  const lastPollAt = otpLastPollAtByAccount.get(accountName) || 0;
  if (now - lastPollAt < OTP_EMAIL_POLL_INTERVAL_MS) {
    return true;
  }
  otpLastPollAtByAccount.set(accountName, now);

  const sinceMs = otpRequestSinceByAccount.get(accountName) || now;
  const pollResult = await fetchOtpCodeFromEmail({ accountName, sinceMs });
  const otpCode = pollResult.otpCode || "";
  const lastStatusLogAt = otpLastStatusLogAtByAccount.get(accountName) || 0;
  const shouldLogStatus = now - lastStatusLogAt >= 15000;
  if (!otpCode && shouldLogStatus) {
    if (pollResult.missingConfig) {
      console.log(
        `账号 [${accountName}] 未配置完整 OTP_IMAP_*，暂无法从邮箱读取验证码。`
      );
    } else if (pollResult.checkedCount === 0) {
      console.log(`账号 [${accountName}] 轮询邮箱中：近时间窗口未发现新邮件。`);
    } else if (pollResult.matchedSubjectCount === 0) {
      // 主题未命中属于常态噪音，这里不输出日志。
    } else {
      console.log(
        `账号 [${accountName}] 轮询邮箱中：已匹配主题邮件，但正文未解析出 4-8 位验证码。`
      );
    }
    otpLastStatusLogAtByAccount.set(accountName, now);
  }
  if (!otpCode) {
    return true;
  }
  if (otpLastAppliedByAccount.get(accountName) === otpCode) {
    return true;
  }

  const submitted = await fillReceiveOtpCodeAndSubmit(page, otpCode);
  if (submitted) {
    otpLastAppliedByAccount.set(accountName, otpCode);
    console.log(`账号 [${accountName}] 已自动填入邮件回复验证码并提交。`);
  }
  return true;
}

module.exports = {
  isSmsVerifyPanelVisible,
  isReceiveOtpPanelVisible,
  readReceiveOtpInfoFromPage,
  readSmsVerifyInfoFromPage,
  handleFaceVerificationIfPresent,
  handleSmsVerificationIfPresent,
  handleReceiveSmsCodeIfPresent
};

