const path = require("path");

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

module.exports = {
  numberFromEnv,
  millisecondsFromEnvSecOrMs,
  TARGET_URL,
  ACCOUNTS_DIR,
  DEFAULT_ADD_ACCOUNTS_JSON,
  DEFAULT_ALERT_TO,
  BROWSER_VIEWPORT,
  LOGIN_WAIT_TIMEOUT_MS,
  LOGIN_REMIND_INTERVAL_MS,
  SMS_REMIND_INTERVAL_MS,
  SMS_SENT_CLICK_INTERVAL_MS,
  OTP_EMAIL_POLL_INTERVAL_MS,
  OTP_EMAIL_MAX_AGE_MS,
  OTP_RESEND_INTERVAL_MS,
  LOGIN_VERIFY_METHOD
};

