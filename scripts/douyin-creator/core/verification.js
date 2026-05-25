const {
  OTP_RESEND_INTERVAL_MS,
  OTP_EMAIL_POLL_INTERVAL_MS
} = require("./env");
const { sendReceiveOtpEmail, fetchOtpCode } = require("./notification");
const {
  receiveOtpNotifySentByAccount,
  loginStageHintByAccount,
  otpRequestIdByAccount,
  otpRequestSinceByAccount,
  otpLastPollAtByAccount,
  otpLastAppliedByAccount,
  otpLastStatusLogAtByAccount,
  otpLastResendAtByAccount,
  otpReceiveWaitLoggedByAccount
} = require("./state");

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
  let filledInput = null;
  for (const input of inputCandidates) {
    const visible = await input.isVisible({ timeout: 250 }).catch(() => false);
    if (!visible) continue;
    await input.fill(otpCode).catch(() => {});
    filledInput = input;
    break;
  }
  if (!filledInput) return false;

  const verifyBtn = page
    .locator("article:has-text('接收短信验证码') [class*='primary']")
    .filter({ hasText: /(确认|提交|登录|验证|完成)/ })
    .first();
  let btnEnabled = false;
  for (let i = 0; i < 10; i++) {
    const cls = await verifyBtn
      .evaluate((el) => el.className)
      .catch(() => "");
    if (cls && !cls.includes("disabled")) {
      btnEnabled = true;
      break;
    }
    await page.waitForTimeout(300);
  }

  if (btnEnabled) {
    await verifyBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  if (!btnEnabled) {
    await filledInput.press("Enter").catch(() => {});
    await page.waitForTimeout(500);
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
    const panelVisible = await panel
      .isVisible({ timeout: 200 })
      .catch(() => false);
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

async function clickReceiveOtpEntry(page) {
  return clickVerifyEntryByText(page, "接收短信验证码");
}

async function handleReceiveSmsCodeIfPresent(page, paths, accountName, options = {}) {
  const { alwaysTryReceiveEntry = false, sendNotifications = true } = options;
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
  if (sendNotifications && !receiveOtpNotifySentByAccount.has(notifyKey)) {
    await sendReceiveOtpEmail({
      accountName,
      maskedPhone,
      reason: "首次进入接收短信验证码阶段，请回复验证码"
    }).catch((error) => {
      console.error(
        `账号 [${accountName}] 首次发送接收验证码提醒失败:`,
        error.message || error
      );
    });
    receiveOtpNotifySentByAccount.add(notifyKey);
    otpLastResendAtByAccount.set(accountName, Date.now());
    otpReceiveWaitLoggedByAccount.delete(accountName);
  }

  const now = Date.now();
  const lastResendAt = otpLastResendAtByAccount.get(accountName) || 0;
  if (sendNotifications && now - lastResendAt >= OTP_RESEND_INTERVAL_MS) {
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
            `账号 [${accountName}] 重发验证码后提醒失败:`,
            error.message || error
          );
        });
        console.log(
          `账号 [${accountName}] 已先点击“重新发送”，再发送验证码填写页提醒。`
        );
      }
    }
  }

  const lastPollAt = otpLastPollAtByAccount.get(accountName) || 0;
  if (now - lastPollAt < OTP_EMAIL_POLL_INTERVAL_MS) {
    return true;
  }
  otpLastPollAtByAccount.set(accountName, now);

  const requestId = otpRequestIdByAccount.get(accountName) || "";
  const sinceMs = otpRequestSinceByAccount.get(accountName) || now;
  const pollResult = await fetchOtpCode({ accountName, requestId, sinceMs });
  const otpCode = pollResult.otpCode || "";
  const lastStatusLogAt = otpLastStatusLogAtByAccount.get(accountName) || 0;
  const shouldLogStatus = now - lastStatusLogAt >= 15000;
  if (!otpCode && shouldLogStatus) {
    if (pollResult.missingConfig) {
      console.log(
        `账号 [${accountName}] 未配置完整 OTP_IMAP_*，暂无法从邮箱读取验证码。`
      );
    } else if (pollResult.bridgeEnabled && pollResult.missingRequestId) {
      console.log(`账号 [${accountName}] OTP 中转会话尚未创建成功，暂无法读取填写页验证码。`);
    } else if (pollResult.bridgeEnabled) {
      console.log(`账号 [${accountName}] 正在等待 OTP 中转页或邮箱中的新验证码。`);
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
    otpRequestIdByAccount.delete(accountName);
    console.log(`账号 [${accountName}] 已自动填入验证码并提交。`);
  }
  return true;
}

module.exports = {
  isReceiveOtpPanelVisible,
  readReceiveOtpInfoFromPage,
  fillReceiveOtpCodeAndSubmit,
  handleReceiveSmsCodeIfPresent
};
