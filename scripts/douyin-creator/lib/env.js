const fs = require("fs");
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

/** 与 accounts.js 规则一致，避免 env ↔ accounts 循环引用 */
function normalizeAccountDirName(name) {
  return String(name || "").trim().replace(/[\\/:*?"<>|]/g, "_");
}

const CREATOR_EXPORT_ACCOUNT_FILE = "creator-export.json";

/** default-add-accounts.json 内：全局默认 + 按店铺名映射；按 mtime 缓存 */
let creatorExportMainJsonCache = {
  path: "",
  mtimeMs: NaN,
  data: /** @type {{ global: string | null, byAccount: Record<string, string> }} */ ({
    global: null,
    byAccount: {}
  })
};

/** accounts/<店>/creator-export.json 按路径 mtime 缓存 */
const creatorExportPerAccountFileCache = new Map();

function readCreatorExportConfigFromMainJson() {
  const p = DEFAULT_ADD_ACCOUNTS_JSON;
  try {
    const st = fs.statSync(p);
    if (
      creatorExportMainJsonCache.path === p &&
      creatorExportMainJsonCache.mtimeMs === st.mtimeMs
    ) {
      return creatorExportMainJsonCache.data;
    }
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    let global = null;
    if (data && typeof data.creatorExportDateStart === "string") {
      const t = data.creatorExportDateStart.trim();
      global = t || null;
    }
    const byAccount = {};
    if (
      data &&
      data.creatorExportDateStartByAccount &&
      typeof data.creatorExportDateStartByAccount === "object"
    ) {
      for (const [k, v] of Object.entries(data.creatorExportDateStartByAccount)) {
        if (typeof v === "string" && v.trim()) {
          byAccount[String(k).trim()] = v.trim();
        }
      }
    }
    const result = { global, byAccount };
    creatorExportMainJsonCache = { path: p, mtimeMs: st.mtimeMs, data: result };
    return result;
  } catch {
    return { global: null, byAccount: {} };
  }
}

function readCreatorExportFromAccountFile(accountName) {
  const dir = normalizeAccountDirName(accountName);
  if (!dir) return null;
  const full = path.join(ACCOUNTS_DIR, dir, CREATOR_EXPORT_ACCOUNT_FILE);
  try {
    const st = fs.statSync(full);
    const prev = creatorExportPerAccountFileCache.get(full);
    if (prev && prev.mtimeMs === st.mtimeMs) {
      return prev.value;
    }
    const raw = fs.readFileSync(full, "utf-8");
    const data = JSON.parse(raw);
    let v = null;
    if (data && typeof data.creatorExportDateStart === "string") {
      const t = data.creatorExportDateStart.trim();
      v = t || null;
    }
    creatorExportPerAccountFileCache.set(full, { mtimeMs: st.mtimeMs, value: v });
    return v;
  } catch {
    return null;
  }
}

/**
 * 抖创导出「开始日期」文案，如 "3.1" 表示当前自然年的 3 月 1 日。
 *
 * 优先级（后者被前者覆盖）：
 * 1. 环境变量 DOUYIN_CREATOR_EXPORT_DATE_START（全局，所有店铺同一规则）
 * 2. accounts/<店铺目录名>/creator-export.json 的 creatorExportDateStart
 * 3. default-add-accounts.json 的 creatorExportDateStartByAccount["店铺名"]
 * 4. default-add-accounts.json 的 creatorExportDateStart 全局默认
 *
 * @param {string} [accountName] 与 accounts 下目录名一致
 */
function getCreatorExportDateStartSpec(accountName) {
  const fromEnv =
    process.env.DOUYIN_CREATOR_EXPORT_DATE_START ||
    process.env.CREATOR_EXPORT_DATE_START;
  if (fromEnv != null && String(fromEnv).trim()) {
    return String(fromEnv).trim();
  }

  const fromAccountFile = readCreatorExportFromAccountFile(accountName);
  if (fromAccountFile) return fromAccountFile;

  const cfg = readCreatorExportConfigFromMainJson();
  const key = accountName != null ? String(accountName).trim() : "";
  if (key && Object.prototype.hasOwnProperty.call(cfg.byAccount, key)) {
    const per = cfg.byAccount[key];
    if (per) return per;
  }

  return cfg.global;
}

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
  LOGIN_VERIFY_METHOD,
  getCreatorExportDateStartSpec
};

