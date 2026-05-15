const path = require("path");
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { DEFAULT_ALERT_TO, OTP_EMAIL_MAX_AGE_MS } = require("./env");
const {
  sendWeComMarkdown,
  sendWeComImageFromFile,
  sendWeComText,
} = require("./wecom");
const {
  createOtpBridgeSession,
  fetchOtpCodeFromBridge,
  isOtpBridgeLinkEnabled
} = require("./otp-bridge");
const { postInternalApi } = require("../../common/internal-api-client");
const {
  otpRequestIdByAccount,
  otpRequestSinceByAccount,
  otpLastAppliedByAccount,
  otpLastStatusLogAtByAccount,
} = require("./state");

function getMailConfig() {
  const host = process.env.SMTP_HOST || "smtp.qq.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const secure =
    String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false";
  const user = process.env.ALERT_EMAIL_USER || process.env.SMTP_USER || "";
  const pass = process.env.ALERT_EMAIL_PASS || process.env.SMTP_PASS || "";
  const from = process.env.ALERT_EMAIL_FROM || user;
  const to = process.env.ALERT_EMAIL_TO || DEFAULT_ALERT_TO;
  const enabled =
    String(process.env.ALERT_EMAIL_ENABLED || "true").toLowerCase() !== "false";
  return { enabled, host, port, secure, user, pass, from, to };
}

function createSmtpTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass
    }
  });
}

function getOtpInboxConfig() {
  const host = process.env.OTP_IMAP_HOST || process.env.SMTP_HOST || "";
  const port = Number(process.env.OTP_IMAP_PORT || 993);
  const secure =
    String(process.env.OTP_IMAP_SECURE || "true").toLowerCase() !== "false";
  const user =
    process.env.OTP_IMAP_USER ||
    process.env.ALERT_EMAIL_USER ||
    process.env.SMTP_USER ||
    "";
  const pass =
    process.env.OTP_IMAP_PASS ||
    process.env.ALERT_EMAIL_PASS ||
    process.env.SMTP_PASS ||
    "";
  const mailbox = process.env.OTP_IMAP_MAILBOX || "INBOX";
  const subjectPrefix =
    process.env.OTP_REPLY_SUBJECT_PREFIX || "[抖音验证码回复]";
  const fromIncludes = process.env.OTP_REPLY_FROM_INCLUDES || "";
  return {
    host,
    port,
    secure,
    user,
    pass,
    mailbox,
    subjectPrefix,
    fromIncludes
  };
}

function formatNow() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function buildOtpReplySubject(accountName) {
  return `${getOtpInboxConfig().subjectPrefix} 账号${accountName}`;
}

function getOtpReplyToAddress() {
  const otpCfg = getOtpInboxConfig();
  const mailCfg = getMailConfig();
  return process.env.OTP_REPLY_TO || otpCfg.user || mailCfg.to || "";
}

function encodeMailtoAddress(address) {
  return String(address || "")
    .split(",")
    .map((item) => encodeURI(item.trim()))
    .filter(Boolean)
    .join(",");
}

/** 可选：设置后才在 mailto 中带 body；默认不带正文占位 */
function resolveOtpMailtoBody(options = {}) {
  if (options.bodyPlaceholder !== undefined && options.bodyPlaceholder !== null) {
    return String(options.bodyPlaceholder);
  }
  return String(process.env.OTP_MAILTO_BODY_HINT || "").trim();
}

/**
 * @param {{ accountName: string; bodyPlaceholder?: string | null; includeBody?: boolean }} [options]
 * includeBody 为 true 时，仅当 bodyPlaceholder 或环境变量 OTP_MAILTO_BODY_HINT 有内容时才追加 body。
 */
function buildOtpReplyMailtoUrl(options = {}) {
  const accountName = options.accountName || "";
  const includeBody = options.includeBody !== false;
  const bodyText = resolveOtpMailtoBody(options);

  const to = getOtpReplyToAddress();
  const subject = buildOtpReplySubject(accountName);
  if (!to) return "";

  const base = `mailto:${encodeMailtoAddress(to)}?subject=${encodeURIComponent(subject)}`;
  const trimmedBody = bodyText.trim();
  if (!includeBody || !trimmedBody) return base;
  return `${base}&body=${encodeURIComponent(trimmedBody)}`;
}

async function sendWeComSafely(label, accountName, sender) {
  try {
    const sent = await sender();
    if (sent) {
      console.log(`账号 [${accountName}] 已发送${label}企业微信提醒。`);
      return true;
    }
  } catch (error) {
    console.error(
      `账号 [${accountName}] ${label}企业微信提醒失败:`,
      error?.message || error
    );
  }
  return false;
}

async function resolveShopInfoContactByName(shopName) {
  const name = String(shopName || "").trim();
  if (!name) return null;
  try {
    const data = await postInternalApi("/api/feishu/shop-info-contact", {
      shopName: name
    });
    if (!data || !data.found || !data.phone) return null;
    return {
      shopName: String(data.shopName || name),
      recruiter: String(data.recruiter || ""),
      phone: String(data.phone || "").replace(/\D+/g, "")
    };
  } catch (error) {
    console.error(
      `账号 [${name}] 读取店铺信息表联系人失败:`,
      error?.message || error
    );
    return null;
  }
}

function extractOtpCode(text) {
  if (!text) return "";
  const raw = String(text).replace(/\r/g, "\n");
  const replyPart = raw.split(/---\s*原始邮件\s*---/)[0] || raw;
  // 跳过脚本自己发出的“接收验证码提醒”模板邮件，避免把时间年份误判成验证码。
  if (
    /请直接回复本邮件，正文仅填写验证码/.test(replyPart) &&
    /已进入\s*接收短信验证码\s*阶段/.test(replyPart)
  ) {
    return "";
  }
  const lines = replyPart
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^发件人[:：]/.test(line))
    .filter((line) => !/^发送时间[:：]/.test(line))
    .filter((line) => !/^收件人[:：]/.test(line))
    .filter((line) => !/^主题[:：]/.test(line));

  // 优先识别“整行仅验证码”的场景（最可靠）。
  for (const line of lines) {
    if (/^[0-9]{4,8}$/.test(line)) {
      return line;
    }
  }

  const compact = lines.join("\n");

  // 跳过常见日期/时间片段中的数字，避免把 2026/4/15 误识别为验证码。
  const candidates = [];
  const tokenRegex = /\b[0-9]{4,8}\b/g;
  let tokenMatch;
  while ((tokenMatch = tokenRegex.exec(compact)) !== null) {
    const token = tokenMatch[0];
    const start = tokenMatch.index;
    const end = start + token.length;
    const left = start > 0 ? compact[start - 1] : "";
    const right = end < compact.length ? compact[end] : "";
    if (/[0-9/:\-]/.test(left) || /[0-9/:\-]/.test(right)) {
      continue;
    }
    candidates.push(token);
  }
  if (candidates.length === 0) return "";
  const preferSix = candidates.find((item) => item.length === 6);
  return preferSix || candidates[0] || "";
}

function extractOtpCodeFromParsedEmail(
  parsed,
  envelopeSubject = "",
  rawSource = ""
) {
  const htmlText = parsed?.html
    ? String(parsed.html).replace(/<[^>]+>/g, " ")
    : "";
  const candidates = [
    parsed?.text || "",
    parsed?.textAsHtml || "",
    htmlText,
    parsed?.subject || "",
    envelopeSubject || "",
    rawSource || ""
  ];
  for (const item of candidates) {
    const otp = extractOtpCode(item);
    if (otp) return otp;
  }
  return "";
}

async function sendAlertEmail({ accountName, screenshotPath, reason }) {
  const wecomSent = await sendWeComSafely("扫码登录", accountName, async () => {
    const contact = await resolveShopInfoContactByName(accountName);
    const dynamicMentionMobiles = contact?.phone ? [contact.phone] : [];
    const body = [
      "抖音扫码登录",
      `账号：${accountName}`,
      `说明：${reason || "需要重新扫码登录"}`,
      `时间：${formatNow()}`,
      "",
      "请使用抖音 App 扫描二维码完成登录。",
    ].join("\n");
    // 企微 webhook 仅 text 类型支持手机号 @；与说明正文合在一条里，不再发额外 text，也不再在 markdown 里拼「提醒手机号」
    const sent = await sendWeComText(body, {
      mentionMobiles: dynamicMentionMobiles,
    });
    if (screenshotPath) {
      await sendWeComImageFromFile(screenshotPath);
    }
    return sent;
  });
  if (wecomSent) return;

  const cfg = getMailConfig();
  if (!cfg.enabled) {
    console.log("邮件告警已关闭，跳过发送。");
    return;
  }

  if (!cfg.user || !cfg.pass || !cfg.from || !cfg.to) {
    console.log(
      "邮件配置不完整，跳过发送。请设置 ALERT_EMAIL_USER / ALERT_EMAIL_PASS / ALERT_EMAIL_FROM / ALERT_EMAIL_TO。"
    );
    return;
  }

  const transporter = createSmtpTransport(cfg);

  const subject = `[抖音导出告警] 账号${accountName}需要重新扫码登录`;
  const html = `
    <div>
      <p>账号 <b>${accountName}</b> 需要重新扫码登录。</p>
      <p>触发原因: ${reason}</p>
      <p>截图时间: ${formatNow()}</p>
    </div>
  `;

  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to,
    subject,
    html,
    attachments: [
      {
        filename: path.basename(screenshotPath),
        path: screenshotPath
      }
    ]
  });
  console.log(`账号 [${accountName}] 已发送扫码提醒邮件到: ${cfg.to}`);
}

async function sendSmsVerifyEmail({
  accountName,
  maskedPhone,
  smsContent,
  smsTarget
}) {
  const wecomSent = await sendWeComSafely("短信验证", accountName, async () =>
    sendWeComMarkdown(
      [
        "### 抖音发送短信验证",
        `账号：\`${accountName}\``,
        `手机号：\`${maskedPhone || "未识别"}\``,
        `短信内容：\`${smsContent || "未识别"}\``,
        `发送至：\`${smsTarget || "未识别"}\``,
        `时间：${formatNow()}`,
        "",
        "请按页面要求用对应手机号发送以上短信内容。"
      ].join("\n")
    )
  );
  if (wecomSent) return;

  const cfg = getMailConfig();
  if (!cfg.enabled) {
    console.log("邮件告警已关闭，跳过发送。");
    return;
  }
  if (!cfg.user || !cfg.pass || !cfg.from || !cfg.to) {
    console.log("邮件配置不完整，跳过发送短信验证提醒。");
    return;
  }

  const transporter = createSmtpTransport(cfg);

  const subject = `[抖音短信验证] 账号${accountName}需要发送验证短信`;
  const html = `
    <div>
      <p>账号 <b>${accountName}</b> 登录后触发身份验证，请发送短信。</p>
      <p>手机号(掩码): <b>${maskedPhone || "未识别"}</b></p>
      <p>短信内容: <b>${smsContent || "未识别"}</b></p>
      <p>发送至: <b>${smsTarget || "未识别"}</b></p>
      <p>时间: ${formatNow()}</p>
    </div>
  `;

  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to,
    subject,
    html
  });
  console.log(`账号 [${accountName}] 已发送短信验证提醒邮件到: ${cfg.to}`);
}

async function sendReceiveOtpEmail({ accountName, maskedPhone, reason }) {
  const subject = buildOtpReplySubject(accountName);
  const reasonText = reason || "等待用户填写验证码";
  let otpBridgeUrl = "";
  let requestId = "";
  if (isOtpBridgeLinkEnabled()) {
    try {
      const session = await createOtpBridgeSession({
        accountName,
        maskedPhone,
        reason: reasonText
      });
      otpBridgeUrl = String(session.entryUrl || "");
      requestId = String(session.requestId || "");
    } catch (error) {
      console.error(
        `账号 [${accountName}] 创建 OTP 中转会话失败:`,
        error?.message || error
      );
    }
  }

  if (requestId) {
    otpRequestIdByAccount.set(accountName, requestId);
  } else {
    otpRequestIdByAccount.delete(accountName);
  }
  otpRequestSinceByAccount.set(accountName, Date.now());
  otpLastAppliedByAccount.delete(accountName);
  otpLastStatusLogAtByAccount.delete(accountName);

  const wecomSent = await sendWeComSafely("接收验证码", accountName, async () => {
    return sendWeComMarkdown(
      [
        "### 抖音验证码",
        `账号：\`${accountName}\``,
        `手机号：\`${maskedPhone || "未识别"}\``,
        `说明：${reasonText}`,
        `时间：${formatNow()}`,
        otpBridgeUrl ? `[打开验证码填写页](${otpBridgeUrl})` : "验证码填写页创建失败，请检查 OTP bridge 服务是否可用。",
      ]
        .filter(Boolean)
        .join("\n")
    );
  });
  if (wecomSent) return;

  const cfg = getMailConfig();
  if (!cfg.enabled) {
    console.log("邮件告警已关闭，跳过发送。");
    return;
  }
  if (!cfg.user || !cfg.pass || !cfg.from || !cfg.to) {
    console.log("邮件配置不完整，跳过发送接收验证码提醒。");
    return;
  }

  const html = `
    <div>
      <p>账号 <b>${accountName}</b> 已进入 <b>接收短信验证码</b> 阶段。</p>
      <p>手机号(掩码): <b>${maskedPhone || "未识别"}</b></p>
      ${
        otpBridgeUrl
          ? `<p>推荐直接打开验证码填写页：<a href="${otpBridgeUrl.replace(/"/g, "&quot;")}">${otpBridgeUrl.replace(/</g, "&lt;")}</a></p>`
          : "<p>验证码填写页创建失败，请检查 OTP bridge 服务是否可用。</p>"
      }
      <p>说明: ${reasonText}</p>
      <p>时间: ${formatNow()}</p>
    </div>
  `;

  const transporter = createSmtpTransport(cfg);
  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to,
    subject,
    html
  });
  console.log(`账号 [${accountName}] 已发送接收验证码提醒邮件到: ${cfg.to}`);
  return {
    requestId,
    otpBridgeUrl,
  };
}

async function fetchOtpCodeFromEmailOnly({ accountName, sinceMs }) {
  const cfg = getOtpInboxConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    return {
      otpCode: "",
      checkedCount: 0,
      matchedSubjectCount: 0,
      missingConfig: true
    };
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const getErrorCode = (err) =>
    (err && (err.code || err.errno || err.syscall)) || "";
  const shouldRetryImap = (err) => {
    const code = String(getErrorCode(err) || "").toUpperCase();
    return [
      "EADDRNOTAVAIL",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ENETUNREACH",
      "EHOSTUNREACH"
    ].includes(code);
  };

  const maxAttempts = Math.max(
    1,
    Number.parseInt(process.env.OTP_IMAP_MAX_ATTEMPTS || "3", 10) || 3
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = new ImapFlow({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      logger: false,
      emitLogs: false,
      logRaw: false,
      auth: {
        user: cfg.user,
        pass: cfg.pass
      }
    });

    let connected = false;
    client.on("error", (err) => {
      // 不要让 ImapFlow 的异步 error 事件把整个进程打崩。
      console.error(
        `账号 [${accountName}] IMAP 连接异常:`,
        err?.message || err
      );
    });

    try {
      await client.connect();
      connected = true;
      const lock = await client.getMailboxLock(cfg.mailbox);
      try {
        const hasSinceMs = Number.isFinite(sinceMs) && sinceMs > 0;
        const effectiveSinceMs = hasSinceMs
          ? sinceMs
          : Date.now() - OTP_EMAIL_MAX_AGE_MS;
        const searchSince = new Date(
          Math.max(effectiveSinceMs - OTP_EMAIL_MAX_AGE_MS, 0)
        );
        const uids = await client.search({ since: searchSince });
        const reversed = uids.slice().reverse();
        let checkedCount = 0;
        let matchedSubjectCount = 0;
        for (const uid of reversed) {
          checkedCount += 1;
          const msg = await client.fetchOne(uid, {
            envelope: true,
            internalDate: true
          });
          if (!msg) continue;
          const internalTimeMs = msg.internalDate
            ? msg.internalDate.getTime()
            : 0;
          const envelopeTimeMs = msg.envelope?.date
            ? new Date(msg.envelope.date).getTime()
            : 0;
          const messageTimeMs =
            internalTimeMs ||
            (Number.isFinite(envelopeTimeMs) ? envelopeTimeMs : 0);
          // 仅处理“发送提醒邮件之后”的回复，避免误读历史验证码邮件。
          if (hasSinceMs && messageTimeMs && messageTimeMs < sinceMs) {
            continue;
          }
          if (
            msg.internalDate &&
            msg.internalDate.getTime() + OTP_EMAIL_MAX_AGE_MS < Date.now()
          ) {
            continue;
          }

          const subject = msg.envelope?.subject || "";
          if (!subject.includes(cfg.subjectPrefix)) continue;
          if (accountName && !subject.includes(accountName)) continue;
          matchedSubjectCount += 1;
          const fromText = (msg.envelope?.from || [])
            .map((item) => `${item.name || ""} <${item.address || ""}>`)
            .join(" ");
          if (cfg.fromIncludes && !fromText.includes(cfg.fromIncludes))
            continue;

          const sourceMsg = await client.fetchOne(uid, { source: true });
          if (!sourceMsg || !sourceMsg.source) continue;
          const parsed = await simpleParser(sourceMsg.source);
          const fullText = String(parsed?.text || "").replace(/\r/g, "\n");
          console.log(
            `账号 [${accountName}] 监听到验证码回复邮件: subject="${subject}" from="${fromText || "unknown"}"\n----- 邮件正文开始 -----\n${fullText || "(empty)"}\n----- 邮件正文结束 -----`
          );
          const otpCode = extractOtpCodeFromParsedEmail(
            parsed,
            subject,
            sourceMsg.source.toString("utf-8")
          );
          if (otpCode) {
            console.log(
              `账号 [${accountName}] 已提取验证码: ${otpCode}（来自回复邮件）\n----- 提取命中邮件正文开始 -----\n${fullText || "(empty)"}\n----- 提取命中邮件正文结束 -----`
            );
            return {
              otpCode,
              checkedCount,
              matchedSubjectCount,
              missingConfig: false
            };
          }
          console.log(
            `账号 [${accountName}] 未提取到验证码，以下为该邮件完整正文(原文):\n----- 邮件开始 -----\n${parsed?.text || "(empty)"}\n----- 邮件结束 -----`
          );
          console.log(
            `账号 [${accountName}] 已匹配回复邮件但未提取到验证码（仅识别 4-8 位数字）。`
          );
        }
        return {
          otpCode: "",
          checkedCount,
          matchedSubjectCount,
          missingConfig: false
        };
      } finally {
        lock.release();
      }
    } catch (error) {
      const code = String(getErrorCode(error) || "");
      console.error(
        `账号 [${accountName}] 拉取回复验证码邮件失败(第${attempt}/${maxAttempts}次, code=${code}):`,
        error?.message || error
      );
      const canRetry = attempt < maxAttempts && shouldRetryImap(error);
      if (!canRetry) {
        break;
      }
      const backoffMs = Math.min(10_000, 500 * Math.pow(2, attempt - 1));
      await sleep(backoffMs);
    } finally {
      if (connected) {
        await client.logout().catch(() => {});
      } else {
        // 未成功 connect 时，logout 可能会抛错；静默处理即可。
        await client.logout().catch(() => {});
      }
    }
  }

  return {
    otpCode: "",
    checkedCount: 0,
    matchedSubjectCount: 0,
    missingConfig: false
  };
}

async function fetchOtpCode({ accountName, requestId, sinceMs }) {
  try {
    const bridgeResult = await fetchOtpCodeFromBridge({ requestId });
    if (bridgeResult.otpCode) {
      console.log(
        `账号 [${accountName}] 已提取验证码: ${bridgeResult.otpCode}（来自 OTP 中转页）`
      );
      return bridgeResult;
    }
  } catch (error) {
    console.error(
      `账号 [${accountName}] 读取 OTP 中转页验证码失败:`,
      error?.message || error
    );
  }

  const emailResult = await fetchOtpCodeFromEmailOnly({ accountName, sinceMs });
  return {
    ...emailResult,
    bridgeEnabled: isOtpBridgeLinkEnabled(),
    missingRequestId: !requestId
  };
}

async function sendFaceVerifyEmail({ accountName, screenshotPath, reason }) {
  const wecomSent = await sendWeComSafely("刷脸验证", accountName, async () => {
    const text = [
      "### 抖音刷脸验证",
      `账号：\`${accountName}\``,
      `说明：${reason || "需要刷脸验证"}`,
      `时间：${formatNow()}`,
      "",
      "请使用抖音 App 扫描刷脸二维码并完成人脸验证。"
    ].join("\n");
    const sent = await sendWeComMarkdown(text);
    if (screenshotPath) {
      await sendWeComImageFromFile(screenshotPath);
    }
    return sent;
  });
  if (wecomSent) return;

  const cfg = getMailConfig();
  if (!cfg.enabled) {
    console.log("邮件告警已关闭，跳过发送。");
    return;
  }
  if (!cfg.user || !cfg.pass || !cfg.from || !cfg.to) {
    console.log("邮件配置不完整，跳过发送刷脸验证提醒。");
    return;
  }

  const transporter = createSmtpTransport(cfg);

  const subject = `[抖音刷脸验证] 账号${accountName}需要手机刷脸扫码`;
  const html = `
    <div>
      <p>账号 <b>${accountName}</b> 已进入 <b>手机刷脸验证</b> 阶段。</p>
      <p>请使用抖音 App 扫描刷脸二维码并完成人脸验证。</p>
      <p>说明: ${reason || "需要刷脸验证"}</p>
      <p>时间: ${formatNow()}</p>
    </div>
  `;

  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to,
    subject,
    html,
    attachments: [
      {
        filename: path.basename(screenshotPath),
        path: screenshotPath
      }
    ]
  });
  console.log(`账号 [${accountName}] 已发送刷脸验证提醒邮件到: ${cfg.to}`);
}

module.exports = {
  getMailConfig,
  createSmtpTransport,
  getOtpInboxConfig,
  buildOtpReplySubject,
  getOtpReplyToAddress,
  buildOtpReplyMailtoUrl,
  sendAlertEmail,
  sendSmsVerifyEmail,
  sendReceiveOtpEmail,
  sendFaceVerifyEmail,
  fetchOtpCode,
  fetchOtpCodeFromEmail: fetchOtpCodeFromEmailOnly
};
