const fs = require("fs/promises");
const path = require("path");
require("dotenv").config();
const { chromium } = require("playwright");
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const TARGET_URL =
  "https://creator.douyin.com/creator-micro/data-center/content";
const ACCOUNTS_DIR = path.resolve(process.cwd(), "accounts");
/** add 无参数时从此文件读取账号名并批量建目录；可用环境变量 ADD_ACCOUNTS_JSON 覆盖路径 */
const DEFAULT_ADD_ACCOUNTS_JSON = path.resolve(
  process.cwd(),
  process.env.ADD_ACCOUNTS_JSON || "default-add-accounts.json"
);
const DEFAULT_ALERT_TO = "2895845213@qq.com";
const BROWSER_VIEWPORT = { width: 1600, height: 1000 };

function numberFromEnv(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const val = Number(raw);
  if (!Number.isFinite(val) || val <= 0) return defaultValue;
  return val;
}

/** 优先读 *_SEC（秒），否则读 *_MS（毫秒，兼容旧配置），最后 defaultSeconds（秒）→ 毫秒 */
function millisecondsFromEnvSecOrMs(secName, msName, defaultSeconds) {
  const msRaw = process.env[msName];
  if (msRaw) {
    const ms = Number(msRaw);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  const secRaw = process.env[secName];
  if (secRaw) {
    const sec = Number(secRaw);
    if (Number.isFinite(sec) && sec > 0) return Math.round(sec * 1000);
  }
  return Math.round(defaultSeconds * 1000);
}

const LOGIN_WAIT_TIMEOUT_MS = millisecondsFromEnvSecOrMs(
  "LOGIN_WAIT_TIMEOUT_SEC",
  "LOGIN_WAIT_TIMEOUT_MS",
  15 * 60
);
const LOGIN_REMIND_INTERVAL_MS = millisecondsFromEnvSecOrMs(
  "LOGIN_REMIND_INTERVAL_SEC",
  "LOGIN_REMIND_INTERVAL_MS",
  60
);
const SMS_REMIND_INTERVAL_MS = millisecondsFromEnvSecOrMs(
  "SMS_REMIND_INTERVAL_SEC",
  "SMS_REMIND_INTERVAL_MS",
  5 * 60
);
const SMS_SENT_CLICK_INTERVAL_MS = millisecondsFromEnvSecOrMs(
  "SMS_SENT_CLICK_INTERVAL_SEC",
  "SMS_SENT_CLICK_INTERVAL_MS",
  1
);
const OTP_EMAIL_POLL_INTERVAL_MS = millisecondsFromEnvSecOrMs(
  "OTP_EMAIL_POLL_INTERVAL_SEC",
  "OTP_EMAIL_POLL_INTERVAL_MS",
  5
);
const OTP_EMAIL_MAX_AGE_MS = millisecondsFromEnvSecOrMs(
  "OTP_EMAIL_MAX_AGE_SEC",
  "OTP_EMAIL_MAX_AGE_MS",
  10 * 60
);
const OTP_RESEND_INTERVAL_MS = millisecondsFromEnvSecOrMs(
  "OTP_RESEND_INTERVAL_SEC",
  "OTP_RESEND_INTERVAL_MS",
  5 * 60
);
const LOGIN_VERIFY_METHOD = (() => {
  const raw = String(process.env.LOGIN_VERIFY_METHOD || "qr")
    .trim()
    .toLowerCase();
  if (raw === "sms" || raw === "qr") return raw;
  if (
    raw === "receive_sms_code" ||
    raw === "receive_sms" ||
    raw === "receive-otp" ||
    raw === "otp"
  ) {
    return "receive_sms_code";
  }
  return "qr";
})();
const qrDataUrlStateByPage = new WeakMap();

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function extractQrDataUrls(text) {
  if (!text || typeof text !== "string") return [];
  const matches =
    text.match(/data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=]+/gi) || [];
  return matches.filter((item) => item.length > 4000);
}

function readPngSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  const pngSignatureHex = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignatureHex) return null;
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { width, height };
}

async function saveDataUrlPng(dataUrl, savePath, options = {}) {
  if (!dataUrl || typeof dataUrl !== "string") return false;
  const matched = dataUrl.match(
    /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i
  );
  if (!matched) return false;
  const minBytes = options.minBytes || 500;
  const base64 = matched[2] || "";
  if (!base64) return false;
  const buf = Buffer.from(base64, "base64");
  if (!buf || buf.length < minBytes) return false;
  await fs.writeFile(savePath, buf);
  return true;
}

function attachQrDataUrlSniffer(page) {
  if (qrDataUrlStateByPage.has(page)) return;
  const state = { dataUrls: [] };
  qrDataUrlStateByPage.set(page, state);

  page.on("response", async (response) => {
    try {
      const url = response.url() || "";
      if (!url.includes("douyin.com")) return;

      const headers = await response.allHeaders().catch(() => ({}));
      const contentType = String(headers["content-type"] || "").toLowerCase();
      const likelyTextPayload =
        contentType.includes("json") ||
        contentType.includes("text") ||
        contentType.includes("javascript") ||
        contentType.includes("html");
      if (!likelyTextPayload) return;

      const text = await response.text().catch(() => "");
      if (!text || text.length < 64) return;
      const urls = extractQrDataUrls(text);
      if (urls.length === 0) return;

      for (const item of urls) {
        state.dataUrls.push(item);
      }
      // 只保留最近候选，避免长时间运行内存膨胀。
      if (state.dataUrls.length > 8) {
        state.dataUrls = state.dataUrls.slice(-8);
      }
    } catch {
      // 响应抓取失败不影响主流程
    }
  });
}

async function tryCaptureQrFromDataUrl(page, screenshotPath) {
  // 1) 第一优先：直接使用 img[aria-label='二维码'] 的 src。
  const ariaQrSrc = await page
    .evaluate(() => {
      const el = document.querySelector("img[aria-label='二维码']");
      if (!el || !el.getAttribute) return "";
      return el.getAttribute("src") || "";
    })
    .catch(() => "");
  if (
    await saveDataUrlPng(ariaQrSrc, screenshotPath, {
      minBytes: 1500,
      minSide: 180,
      maxAspectDiff: 0.25
    }).catch(() => false)
  ) {
    return true;
  }

  // 2) 优先从 DOM 提取其余二维码 dataURL，避免受视口裁切影响。
  const domDataUrls = await page
    .evaluate(() => {
      const all = [];
      const pushUnique = (src) => {
        if (!src || typeof src !== "string") return;
        if (!/^data:image\/(?:png|jpe?g);base64,/i.test(src)) return;
        if (src.length < 4000) return;
        if (!all.includes(src)) all.push(src);
      };
      const selectors = [
        "[class*='animate_qrcode_container'] [class*='qrcode_img'][src^='data:image/']",
        "[class*='animate_qrcode'] [class*='qrcode_img'][src^='data:image/']",
        "img[aria-label='二维码'][src^='data:image/']",
        "[aria-label='二维码'] img[src^='data:image/']",
        "[class*='qrcode'] img[src^='data:image/']"
      ];
      for (const selector of selectors) {
        const nodeList = document.querySelectorAll(selector);
        for (const el of nodeList) {
          const src = el && el.getAttribute ? el.getAttribute("src") : "";
          pushUnique(src);
        }
      }
      return all;
    })
    .catch(() => []);
  for (const item of domDataUrls) {
    const ok = await saveDataUrlPng(item, screenshotPath, {
      minBytes: 1500,
      minSide: 180,
      maxAspectDiff: 0.25
    }).catch(() => false);
    if (ok) {
      return true;
    }
  }

  // 3) 再尝试从网络响应缓存中提取 dataURL。
  const state = qrDataUrlStateByPage.get(page);
  const candidates = (state?.dataUrls || [])
    .slice()
    .sort((a, b) => b.length - a.length);
  for (const item of candidates) {
    const ok = await saveDataUrlPng(item, screenshotPath, {
      minBytes: 1500,
      minSide: 180,
      maxAspectDiff: 0.25
    }).catch(() => false);
    if (ok) {
      return true;
    }
  }
  return false;
}

async function tryCaptureFaceQrFromDom(page, screenshotPath) {
  const domDataUrls = await page
    .evaluate(() => {
      const urls = [];
      const seen = new Set();
      const imgs = Array.from(
        document.querySelectorAll(
          "img[aria-label='二维码'][src^='data:image/']"
        )
      );
      for (const img of imgs) {
        const parent = img.parentElement;
        const container = parent?.parentElement || parent;
        if (!parent || !container) continue;

        let hasHowToScanSibling = false;
        for (const node of Array.from(container.children)) {
          if (node === parent || node === img) continue;
          const text = (node.textContent || "").replace(/\s+/g, "");
          if (text.includes("如何扫码")) {
            hasHowToScanSibling = true;
            break;
          }
        }
        if (!hasHowToScanSibling) continue;

        const src = img.getAttribute("src") || "";
        if (!/^data:image\/(?:png|jpe?g);base64,/i.test(src)) continue;
        if (!src || src.length < 4000) continue;
        if (seen.has(src)) continue;
        seen.add(src);
        urls.push(src);
      }
      return urls;
    })
    .catch(() => []);

  for (const item of domDataUrls) {
    const ok = await saveDataUrlPng(item, screenshotPath, {
      minBytes: 1500,
      minSide: 180,
      maxAspectDiff: 0.25
    }).catch(() => false);
    if (ok) return true;
  }
  return false;
}

function normalizeAccountName(name) {
  return name.trim().replace(/[\\/:*?"<>|]/g, "_");
}

async function loadDefaultAddAccountNames() {
  let raw;
  try {
    raw = await fs.readFile(DEFAULT_ADD_ACCOUNTS_JSON, "utf-8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(
        `未找到 ${DEFAULT_ADD_ACCOUNTS_JSON}。请创建该文件，或使用: npm run add -- 账号名`
      );
    }
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${DEFAULT_ADD_ACCOUNTS_JSON} 不是合法 JSON`);
  }
  let list = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (data && Array.isArray(data.accounts)) {
    list = data.accounts;
  } else {
    throw new Error(
      `${DEFAULT_ADD_ACCOUNTS_JSON} 格式应为 ["名称"] 或 {"accounts":["名称"]}`
    );
  }
  const names = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const n = normalizeAccountName(item);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  return names;
}

function getAccountPaths(accountName) {
  const accountDir = path.join(ACCOUNTS_DIR, accountName);
  return {
    accountDir,
    storageStatePath: path.join(accountDir, "storageState.json"),
    cookiesPath: path.join(accountDir, "cookies.json"),
    dataDir: path.join(accountDir, "data"),
    alertDir: path.join(accountDir, "alerts")
  };
}

async function isLoggedInAtTarget(page) {
  const inTargetPage = page
    .url()
    .includes("/creator-micro/data-center/content");
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
  const subjectPrefix = process.env.OTP_REPLY_SUBJECT_PREFIX || "[抖音验证码回复]";
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

function extractOtpCodeFromParsedEmail(parsed, envelopeSubject = "", rawSource = "") {
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

function summarizeReplyBeforeOriginal(text, maxLen = 160) {
  if (!text) return "";
  const raw = String(text).replace(/\r/g, "\n");
  const replyPart = raw.split(/---\s*原始邮件\s*---/)[0] || raw;
  const compact = replyPart
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" | ");
  if (!compact) return "";
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen)}...`;
}

async function sendAlertEmail({ accountName, screenshotPath, reason }) {
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
      <p>截图时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}</p>
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
      <p>时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}</p>
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

async function sendReceiveOtpEmail({
  accountName,
  maskedPhone,
  reason
}) {
  const cfg = getMailConfig();
  if (!cfg.enabled) {
    console.log("邮件告警已关闭，跳过发送。");
    return;
  }
  if (!cfg.user || !cfg.pass || !cfg.from || !cfg.to) {
    console.log("邮件配置不完整，跳过发送接收验证码提醒。");
    return;
  }

  const subjectPrefix = getOtpInboxConfig().subjectPrefix;
  const subject = `${subjectPrefix} 账号${accountName}`;
  const html = `
    <div>
      <p>账号 <b>${accountName}</b> 已进入 <b>接收短信验证码</b> 阶段。</p>
      <p>手机号(掩码): <b>${maskedPhone || "未识别"}</b></p>
      <p>请直接回复本邮件，正文仅填写验证码（4-8位数字）。</p>
      <p>说明: ${reason || "等待用户回复验证码"}</p>
      <p>时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}</p>
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
}

async function fetchOtpCodeFromEmail({ accountName, sinceMs }) {
  const cfg = getOtpInboxConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    return {
      otpCode: "",
      checkedCount: 0,
      matchedSubjectCount: 0,
      missingConfig: true
    };
  }

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

  try {
    await client.connect();
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
        if (cfg.fromIncludes && !fromText.includes(cfg.fromIncludes)) continue;

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
    console.error(
      `账号 [${accountName}] 拉取回复验证码邮件失败:`,
      error.message || error
    );
  } finally {
    await client.logout().catch(() => {});
  }

  return {
    otpCode: "",
    checkedCount: 0,
    matchedSubjectCount: 0,
    missingConfig: false
  };
}

async function sendFaceVerifyEmail({ accountName, screenshotPath, reason }) {
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
      <p>时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}</p>
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

async function captureLoginQrScreenshot(page, paths, accountName) {
  await ensureDir(paths.alertDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(paths.alertDir, `${timestamp}-login-qr.png`);
  await page.waitForTimeout(1500);

  if (await tryCaptureQrFromDataUrl(page, screenshotPath)) {
    console.log(
      `账号 [${accountName}] 已通过 dataURL 保存二维码: ${screenshotPath}`
    );
    return screenshotPath;
  }

  const isBoxLikelyClipped = (box, viewport) => {
    if (!box || !viewport) return true;
    const margin = 3;
    return (
      box.x <= margin ||
      box.y <= margin ||
      box.x + box.width >= viewport.width - margin ||
      box.y + box.height >= viewport.height - margin
    );
  };

  const clipAroundBox = (box, viewport, pad = 60) => {
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    const width = Math.max(
      1,
      Math.min(Math.floor(box.width + pad * 2), viewport.width - x)
    );
    const height = Math.max(
      1,
      Math.min(Math.floor(box.height + pad * 2), viewport.height - y)
    );
    return { x, y, width, height };
  };

  const setPageZoom = async (zoom) => {
    await page
      .evaluate((z) => {
        const zoomVal = String(z);
        document.documentElement.style.zoom = zoomVal;
        if (document.body) {
          document.body.style.zoom = zoomVal;
        }
      }, zoom)
      .catch(() => {});
  };

  const ensureWideViewport = async (minWidth = 1500, minHeight = 900) => {
    const viewport = page.viewportSize() || BROWSER_VIEWPORT;
    const nextViewport = {
      width: Math.max(viewport.width, minWidth),
      height: Math.max(viewport.height, minHeight)
    };
    if (
      nextViewport.width === viewport.width &&
      nextViewport.height === viewport.height
    ) {
      return viewport;
    }
    await page.setViewportSize(nextViewport).catch(() => {});
    await page.waitForTimeout(180);
    return page.viewportSize() || nextViewport;
  };

  const tryCaptureLocator = async (locator) => {
    const visible = await locator
      .isVisible({ timeout: 1200 })
      .catch(() => false);
    if (!visible) return false;

    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(120);

    let viewport = page.viewportSize() || BROWSER_VIEWPORT;
    let box = await locator.boundingBox().catch(() => null);
    if (!box) return false;
    if (box.width < 120 || box.height < 120) return false;
    const ratioDiff =
      Math.abs(box.width - box.height) / Math.max(box.width, box.height);
    if (ratioDiff > 0.4) return false;

    // 某些窗口尺寸下二维码会贴着右边界，先缩放页面再重算位置，避免截图被裁掉。
    if (isBoxLikelyClipped(box, viewport)) {
      await setPageZoom(0.9);
      await page.waitForTimeout(180);
      box = await locator.boundingBox().catch(() => box);
    }

    if (!box || isBoxLikelyClipped(box, viewport)) {
      viewport = await ensureWideViewport();
      box = await locator.boundingBox().catch(() => box);
    }

    if (!box || isBoxLikelyClipped(box, viewport)) {
      const fullPagePath = screenshotPath.replace(
        /-login-qr\.png$/,
        "-login-fullpage.png"
      );
      await page
        .screenshot({ path: fullPagePath, fullPage: true })
        .catch(() => {});
      return false;
    }

    const clip = clipAroundBox(box, viewport, 70);
    await page.screenshot({ path: screenshotPath, clip }).catch(() => {});
    if (await fileExists(screenshotPath)) {
      return true;
    }
    await locator.screenshot({ path: screenshotPath }).catch(() => {});
    return fileExists(screenshotPath);
  };

  const qrSelectors = [
    "[aria-label='二维码']",
    "div:has-text('扫码登录') img[src*='qrcode']",
    "div:has-text('扫码登录') canvas",
    "[role='dialog'] img[src*='qrcode']",
    "[role='dialog'] canvas",
    "img[src*='qrcode']",
    "img[alt*='二维码']",
    "[class*='qrcode'] img",
    "[class*='qrcode'] canvas"
  ];

  for (const selector of qrSelectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 6);
    for (let i = 0; i < count; i += 1) {
      if (await tryCaptureLocator(locator.nth(i))) {
        console.log(
          `账号 [${accountName}] 已保存二维码截图: ${screenshotPath}`
        );
        return screenshotPath;
      }
    }
  }

  const loginTitle = page.getByText("扫码登录").first();
  const loginTitleVisible = await loginTitle
    .isVisible({ timeout: 600 })
    .catch(() => false);
  if (loginTitleVisible) {
    await page
      .screenshot({ path: screenshotPath, fullPage: true })
      .catch(() => {});
    if (await fileExists(screenshotPath)) {
      console.log(
        `账号 [${accountName}] 已保存扫码登录全屏截图: ${screenshotPath}`
      );
      return screenshotPath;
    }
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(`账号 [${accountName}] 已保存登录截图: ${screenshotPath}`);
  return screenshotPath;
}

const smsNotifySentByAccount = new Set();
const receiveOtpNotifySentByAccount = new Set();
const faceNotifySentByAccount = new Set();
const loginStageHintByAccount = new Map();
const lastSmsConfirmClickAtByAccount = new Map();
const otpRequestSinceByAccount = new Map();
const otpLastPollAtByAccount = new Map();
const otpLastAppliedByAccount = new Map();
const otpLastStatusLogAtByAccount = new Map();
const otpLastResendAtByAccount = new Map();
const otpReceiveWaitLoggedByAccount = new Set();

async function readSmsVerifyInfoFromPage(page) {
  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
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
  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  const phoneMatch = bodyText.match(/请使用手机号\s*([0-9*]+)\s*(?:接收|获取)短信验证码/);
  return {
    maskedPhone: phoneMatch ? phoneMatch[1] : ""
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
      .locator("[role='dialog']:has-text('接收短信验证码') input[placeholder*='验证码']")
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
      .locator("[role='dialog']:has-text('接收短信验证码') input[placeholder*='验证码']")
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
      const panels = Array.from(document.querySelectorAll("article"));
      for (const panel of panels) {
        const title = panel.querySelector("[class*='title']");
        if (!title || normalize(title.textContent) !== "接收短信验证码") continue;
        const resendCandidates = Array.from(
          panel.querySelectorAll("[class*='button_text'], span, div")
        );
        for (const node of resendCandidates) {
          if (normalize(node.textContent) !== "重新发送") continue;
          const el = /** @type {HTMLElement} */ (node);
          el.click();
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
    await node.click().catch(() => {});
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

async function hasReceiveOtpResendButton(page) {
  const candidates = [
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
    if (await node.isVisible({ timeout: 200 }).catch(() => false)) {
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
    })
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
    page.locator(`[id*='uc-second-verify'] div:has-text('${targetText}')`).last(),
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

async function captureVerifyDialogScreenshot(page, paths, accountName, suffix) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(
    paths.alertDir,
    `${timestamp}-${suffix}.png`
  );
  const dialog = page.locator("[role='dialog']").last();
  const dialogVisible = await dialog
    .isVisible({ timeout: 800 })
    .catch(() => false);
  if (dialogVisible) {
    await dialog.screenshot({ path: screenshotPath }).catch(() => {});
  }
  if (!(await fileExists(screenshotPath))) {
    await page
      .screenshot({ path: screenshotPath, fullPage: true })
      .catch(() => {});
  }
  console.log(`账号 [${accountName}] 已保存验证截图: ${screenshotPath}`);
  return screenshotPath;
}

async function captureFaceQrScreenshot(page, paths, accountName) {
  await ensureDir(paths.alertDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(
    paths.alertDir,
    `${timestamp}-face-verify.png`
  );

  if (await tryCaptureFaceQrFromDom(page, screenshotPath)) {
    console.log(
      `账号 [${accountName}] 已通过 DOM 保存刷脸二维码: ${screenshotPath}`
    );
    return screenshotPath;
  }

  const clipAroundBox = (box, viewport, pad = 14) => {
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    const width = Math.max(
      1,
      Math.min(Math.ceil(box.width + pad * 2), viewport.width - x)
    );
    const height = Math.max(
      1,
      Math.min(Math.ceil(box.height + pad * 2), viewport.height - y)
    );
    return { x, y, width, height };
  };

  const tryCaptureLocator = async (locator) => {
    const visible = await locator
      .isVisible({ timeout: 800 })
      .catch(() => false);
    if (!visible) return false;

    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(120);

    const box = await locator.boundingBox().catch(() => null);
    if (!box) return false;
    if (box.width < 100 || box.height < 100) return false;

    const ratioDiff =
      Math.abs(box.width - box.height) / Math.max(box.width, box.height);
    if (ratioDiff > 0.3) return false;

    const viewport = page.viewportSize() || BROWSER_VIEWPORT;
    const clip = clipAroundBox(box, viewport, 14);
    await page.screenshot({ path: screenshotPath, clip }).catch(() => {});
    if (await fileExists(screenshotPath)) {
      return true;
    }

    await locator.screenshot({ path: screenshotPath }).catch(() => {});
    return fileExists(screenshotPath);
  };

  const qrSelectors = [
    "#uc_verification_animate_qrcode_container img[aria-label='二维码']",
    "[id*='uc_verification_animate_qrcode_container'] img[aria-label='二维码']",
    "div:has-text('手机刷脸验证') img[aria-label='二维码']",
    "div:has-text('如何扫码') ~ div img[aria-label='二维码']",
    "div:has-text('手机刷脸验证') [class*='animate_qrcode_container'] img",
    "div:has-text('手机刷脸验证') [class*='qrcode'] img",
    "div:has-text('手机刷脸验证') [class*='qrcode'] canvas",
    "img[aria-label='二维码']",
    "img[src*='qrcode']",
    "[class*='qrcode'] img",
    "[class*='qrcode'] canvas",
    "canvas"
  ];

  for (const selector of qrSelectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 4);
    for (let i = 0; i < count; i += 1) {
      if (await tryCaptureLocator(locator.nth(i))) {
        console.log(
          `账号 [${accountName}] 已保存刷脸二维码截图: ${screenshotPath}`
        );
        return screenshotPath;
      }
    }
  }

  const faceDialog = page
    .locator("[role='dialog']")
    .filter({ hasText: "手机刷脸验证" })
    .last();
  const dialogVisible = await faceDialog
    .isVisible({ timeout: 600 })
    .catch(() => false);
  if (dialogVisible) {
    await faceDialog.screenshot({ path: screenshotPath }).catch(() => {});
    if (await fileExists(screenshotPath)) {
      console.log(
        `账号 [${accountName}] 已保存刷脸验证弹窗截图: ${screenshotPath}`
      );
      return screenshotPath;
    }
  }

  return captureVerifyDialogScreenshot(page, paths, accountName, "face-verify");
}

async function hasVisibleQr(page) {
  const qrSelectors = [
    "img[src*='qrcode']",
    "img[alt*='二维码']",
    "[class*='qrcode'] img",
    "[class*='qrcode'] canvas",
    "canvas"
  ];
  for (const selector of qrSelectors) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (visible) {
      return true;
    }
  }
  return false;
}

async function handleFaceVerificationIfPresent(
  page,
  paths,
  accountName,
  options = {}
) {
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

  const qrVisible = await hasVisibleQr(page);
  if (!qrVisible) {
    return false;
  }

  loginStageHintByAccount.set(accountName, "当前处于手机刷脸验证阶段");
  if (faceNotifySentByAccount.has(accountName)) {
    return true;
  }

  const screenshotPath = await captureFaceQrScreenshot(
    page,
    paths,
    accountName
  );
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

async function resendLoginReminderByStage(
  page,
  paths,
  accountName,
  baseReason
) {
  const stageHint = loginStageHintByAccount.get(accountName) || "";

  if (stageHint.includes("手机刷脸验证")) {
    const screenshotPath = await captureFaceQrScreenshot(
      page,
      paths,
      accountName
    );
    await sendFaceVerifyEmail({
      accountName,
      screenshotPath,
      reason: `${baseReason}（刷脸二维码可能过期，定时重发）`
    }).catch((error) => {
      console.error(
        `账号 [${accountName}] 刷脸重发邮件失败:`,
        error.message || error
      );
    });
    return;
  }

  if (stageHint.includes("接收短信验证码")) {
    const { maskedPhone } = await readReceiveOtpInfoFromPage(page);
    await sendReceiveOtpEmail({
      accountName,
      maskedPhone,
      reason: `${baseReason}（仍在等待用户邮件回复验证码）`
    }).catch((error) => {
      console.error(
        `账号 [${accountName}] 接收验证码重发邮件失败:`,
        error.message || error
      );
    });
    return;
  }

  if (stageHint.includes("短信验证")) {
    const { maskedPhone, smsContent, smsTarget } =
      await readSmsVerifyInfoFromPage(page);
    await sendSmsVerifyEmail({
      accountName,
      maskedPhone,
      smsContent,
      smsTarget
    }).catch((error) => {
      console.error(
        `账号 [${accountName}] 短信验证重发邮件失败:`,
        error.message || error
      );
    });
    return;
  }

  const resendReason = stageHint
    ? `${baseReason}（${stageHint}，二维码可能过期，定时重发）`
    : `${baseReason}（二维码可能过期，定时重发）`;
  await notifyLoginRequired(page, paths, accountName, resendReason);
}

async function handleSmsVerificationIfPresent(
  page,
  paths,
  accountName,
  options = {}
) {
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
  const { maskedPhone, smsContent, smsTarget } =
    await readSmsVerifyInfoFromPage(page);

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

async function handleReceiveSmsCodeIfPresent(
  page,
  paths,
  accountName,
  options = {}
) {
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
        otpRequestSinceByAccount.set(accountName, now);
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

async function clickIfVisible(locator, timeout = 3500) {
  if (
    await locator
      .first()
      .isVisible({ timeout })
      .catch(() => false)
  ) {
    await locator.first().click();
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
  await sendAlertEmail({ accountName, screenshotPath, reason }).catch(
    (error) => {
      console.error(
        `账号 [${accountName}] 邮件发送失败:`,
        error.message || error
      );
    }
  );
}

async function waitForManualLoginFlow(
  page,
  paths,
  accountName,
  reason,
  timeoutMs = LOGIN_WAIT_TIMEOUT_MS,
  resendEveryMs = LOGIN_REMIND_INTERVAL_MS
) {
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
      return;
    }

    if (smsVerifyMode) {
      if (step === "identity_verify" || step === "sms_panel") {
        await handleSmsVerificationIfPresent(page, paths, accountName, {
          alwaysTrySmsEntry: true,
          autoClickSentButton: true
        });
      }
    } else if (receiveSmsCodeMode) {
      if (step === "identity_verify" || step === "receive_sms_code_panel") {
        await handleReceiveSmsCodeIfPresent(page, paths, accountName, {
          alwaysTryReceiveEntry: true
        });
      }
    } else {
      await handleFaceVerificationIfPresent(page, paths, accountName, {
        skipFaceVerify: false
      });
      await handleSmsVerificationIfPresent(page, paths, accountName, {
        alwaysTrySmsEntry: false,
        autoClickSentButton: false
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
    if (reachedSmsNotifyTime || reachedGeneralNotifyTime) {
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
  const { hasStoredAuth, forceManualLogin, manualLoginReason } = options;
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  if (forceManualLogin) {
    console.log(
      `账号 [${accountName}] 当前无有效登录态，需手动扫码并完成验证。`
    );
    const reason = manualLoginReason || "需要手动登录目标账号";
    await notifyLoginRequired(page, paths, accountName, reason);
    await waitForManualLoginFlow(page, paths, accountName, reason);
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(900);
    return;
  }

  if (await isLoggedInAtTarget(page)) {
    console.log(`账号 [${accountName}] 检测到已登录，复用本地会话。`);
    return;
  }

  const reason = hasStoredAuth
    ? "cookies/storageState 失效或已过期"
    : "本地 cookies/storageState 不存在";
  await notifyLoginRequired(page, paths, accountName, reason);
  await waitForManualLoginFlow(page, paths, accountName, reason);
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);
}

async function saveAuth(context, paths, accountName) {
  const cookies = await context.cookies();
  await context.storageState({ path: paths.storageStatePath });
  await fs.writeFile(
    paths.cookiesPath,
    JSON.stringify(cookies, null, 2),
    "utf-8"
  );
  console.log(`账号 [${accountName}] 登录态已保存:`);
  console.log(`- storageState: ${paths.storageStatePath}`);
  console.log(`- cookies: ${paths.cookiesPath}`);
  console.log(`- cookie 数量: ${cookies.length}`);
}

async function exportPostListData(page, paths, accountName) {
  const tabClicked =
    (await clickIfVisible(page.getByRole("tab", { name: "投稿列表" }), 2500)) ||
    (await clickIfVisible(page.getByText("投稿列表"), 2500));

  if (!tabClicked) {
    throw new Error("未找到“投稿列表”标签，请确认页面结构是否变化。");
  }

  await page.waitForTimeout(800);

  let exportBtn = page.getByRole("button", { name: /导出/ }).first();
  const roleBtnVisible = await exportBtn
    .isVisible({ timeout: 2500 })
    .catch(() => false);
  if (!roleBtnVisible) {
    exportBtn = page.locator("button:has-text('导出数据')").first();
  }

  if (!(await exportBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error("未找到“导出”按钮，请确认账号权限或页面加载状态。");
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await exportBtn.click();
  const download = await downloadPromise;

  const rawName =
    download.suggestedFilename() || `douyin-content-${Date.now()}.xlsx`;
  const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const savePath = path.join(paths.dataDir, `${timestamp}-${safeName}`);
  await download.saveAs(savePath);

  console.log(`账号 [${accountName}] 导出成功:`);
  console.log(`- 文件路径: ${savePath}`);
}

async function listAccountDirs() {
  await ensureDir(ACCOUNTS_DIR);
  const entries = await fs.readdir(ACCOUNTS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function parseCliCommand() {
  const args = process.argv.slice(2);
  const command = (args[0] || "export").toLowerCase();
  if (!["add", "export", "list"].includes(command)) {
    throw new Error(
      "只支持三种命令: add / export / list。示例: npm run add -- 账号A / npm run add / npm run export / npm run export -- 账号A [账号B] / npm run list"
    );
  }
  const tail = args.slice(1);
  if (command === "export") {
    const exportAccountFilters = tail
      .map((s) => normalizeAccountName(s))
      .filter(Boolean);
    return { command, exportAccountFilters };
  }
  const accountName = normalizeAccountName(tail.join(" ").trim());
  return { command, accountName };
}

async function resolveAccountsToRun(
  command,
  accountNameFromArg,
  exportAccountFilters
) {
  const existingAccounts = await listAccountDirs();
  if (command === "list") {
    return existingAccounts;
  }
  if (command === "add") {
    if (accountNameFromArg) {
      return [accountNameFromArg];
    }
    const names = await loadDefaultAddAccountNames();
    if (names.length === 0) {
      throw new Error(
        `${DEFAULT_ADD_ACCOUNTS_JSON} 中没有有效账号名（需为非空字符串）`
      );
    }
    return names;
  }

  if (existingAccounts.length === 0) {
    throw new Error(
      "export 模式未发现账号目录。请先执行 add 命令完成扫码登录。"
    );
  }
  if (!exportAccountFilters || exportAccountFilters.length === 0) {
    return existingAccounts;
  }

  const existingSet = new Set(existingAccounts);
  const missing = [];
  const selected = [];
  const seen = new Set();
  for (const name of exportAccountFilters) {
    if (!existingSet.has(name)) {
      missing.push(name);
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    selected.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `export 指定的账号在 accounts 下无对应目录: ${missing.join(
        ", "
      )}。当前已有: ${existingAccounts.join(", ")}`
    );
  }
  return selected;
}

async function splitAccountsByStorageState(accounts) {
  const withAuth = [];
  const withoutAuth = [];
  for (const accountName of accounts) {
    const paths = getAccountPaths(accountName);
    const hasStorage = await fileExists(paths.storageStatePath);
    if (hasStorage) {
      withAuth.push(accountName);
    } else {
      withoutAuth.push(accountName);
    }
  }
  return { withAuth, withoutAuth };
}

async function runOneAccount(browser, accountName, command, options = {}) {
  const paths = getAccountPaths(accountName);
  await ensureDir(paths.accountDir);
  await ensureDir(paths.dataDir);
  await ensureDir(paths.alertDir);
  const hasStoredAuth = await fileExists(paths.storageStatePath);
  const useStoredAuth =
    typeof options.useStoredAuth === "boolean"
      ? options.useStoredAuth
      : command === "export" && hasStoredAuth;
  const forceManualLogin =
    typeof options.forceManualLogin === "boolean"
      ? options.forceManualLogin
      : command === "add";
  const manualLoginReason = options.manualLoginReason;

  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    acceptDownloads: true,
    storageState: useStoredAuth ? paths.storageStatePath : undefined
  });

  try {
    const page = await context.newPage();
    attachQrDataUrlSniffer(page);
    console.log(
      `\n========== 开始处理账号: ${accountName} (${command}) ==========`
    );
    await openTargetAndEnsureLogin(page, paths, accountName, {
      hasStoredAuth,
      forceManualLogin,
      manualLoginReason
    });
    await saveAuth(context, paths, accountName);
    await exportPostListData(page, paths, accountName);
    console.log(`========== 账号完成: ${accountName} ==========\n`);
    return { accountName, ok: true };
  } catch (error) {
    console.error(`账号 [${accountName}] 执行失败:`, error.message || error);
    return { accountName, ok: false, error: error.message || String(error) };
  } finally {
    await context.close();
  }
}

async function runAccountQueue(browser, accounts, command, options = {}) {
  const results = [];
  for (const accountName of accounts) {
    const result = await runOneAccount(browser, accountName, command, options);
    results.push(result);
  }
  return results;
}

async function main() {
  const parsed = parseCliCommand();
  const { command, accountName, exportAccountFilters } = parsed;
  const accounts = await resolveAccountsToRun(
    command,
    accountName,
    exportAccountFilters
  );

  if (command === "list") {
    console.log(`当前账号数量: ${accounts.length}`);
    if (accounts.length === 0) {
      console.log(
        "未找到账号目录。可先执行: npm run add -- 账号A 或 npm run add（按 default-add-accounts.json 批量建目录）"
      );
      return;
    }

    console.log("\n账号状态:");
    for (const name of accounts) {
      const paths = getAccountPaths(name);
      const hasStorage = await fileExists(paths.storageStatePath);
      const hasCookies = await fileExists(paths.cookiesPath);
      console.log(
        `- ${name} | storageState: ${hasStorage ? "yes" : "no"} | cookies: ${hasCookies ? "yes" : "no"}`
      );
    }
    return;
  }

  if (command === "add") {
    console.log(`当前命令: ${command}`);
    console.log(`本次将创建 ${accounts.length} 个账号目录: ${accounts.join(", ")}`);
    for (const name of accounts) {
      const paths = getAccountPaths(name);
      await ensureDir(paths.accountDir);
      console.log(`- 已创建: ${paths.accountDir}`);
    }
    console.log("\n登录与导出请使用: npm run export");
    return;
  }

  console.log(`当前命令: ${command}`);
  console.log(`本次将处理 ${accounts.length} 个账号: ${accounts.join(", ")}`);

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"]
  });

  let results = [];
  const { withAuth, withoutAuth } =
    await splitAccountsByStorageState(accounts);
  console.log(`导出通道A(已有登录态): ${withAuth.length} 个账号`);
  console.log(`导出通道B(需登录验证): ${withoutAuth.length} 个账号`);
  console.log(
    `登录验证方式: ${
      LOGIN_VERIFY_METHOD === "sms"
        ? "发送短信验证"
        : LOGIN_VERIFY_METHOD === "receive_sms_code"
          ? "接收短信验证码(邮件回填)"
          : "二维码/默认流程"
    }`
  );

  const [authResults, loginResults] = await Promise.all([
    runAccountQueue(browser, withAuth, "export", {
      useStoredAuth: true,
      forceManualLogin: false
    }),
    runAccountQueue(browser, withoutAuth, "export", {
      useStoredAuth: false,
      forceManualLogin: true,
      manualLoginReason: "需先完成登录验证"
    })
  ]);
  results = [...authResults, ...loginResults];

  await browser.close();

  const successCount = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok);
  console.log(`\n全部执行完成: 成功 ${successCount} / ${results.length}`);
  if (failed.length > 0) {
    console.log("失败账号:");
    for (const item of failed) {
      console.log(`- ${item.accountName}: ${item.error}`);
    }
  }
}

main().catch(async (error) => {
  console.error("\n脚本执行失败:", error);
  process.exitCode = 1;
});
