const path = require("path");
const fs = require("fs");
const { getProjectConfigPath } = require("../../common/config-path");

function numberFromEnv(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const val = Number(raw);
  if (!Number.isFinite(val) || val <= 0) return defaultValue;
  return val;
}

const SHOP_LOGIN_URL =
  process.env.SHOP_LOGIN_URL ||
  "https://fxg.jinritemai.com/login/common?channel=zhaoshang";

// 登录成功后期望落到的 home/工作台页面；用于判断是否登录成功
const SHOP_HOME_URL =
  process.env.SHOP_HOME_URL || "https://fxg.jinritemai.com/ffa/mshop/homepage";

const ACCOUNTS_DIR = (() => {
  const envVal = process.env.SHOP_ACCOUNTS_DIR;
  if (envVal) return path.resolve(process.cwd(), envVal);
  const newPath = path.resolve(process.cwd(), "storage/shop-accounts");
  const oldPath = path.resolve(process.cwd(), "accounts-shop");
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    console.warn("[migration] 正在使用旧目录 \"accounts-shop/\"，建议移动到 \"storage/shop-accounts/\" 或设置 SHOP_ACCOUNTS_DIR");
    return oldPath;
  }
  return newPath;
})();

const BROWSER_VIEWPORT = { width: 1440, height: 900 };

// 滑块拖动总时长（毫秒）；略长更易过风控（仍可用 SHOP_SLIDER_DURATION_MS 调短）
const SLIDER_DRAG_DURATION_MS = numberFromEnv("SHOP_SLIDER_DURATION_MS", 1100);

// 每次登录最多重试滑块次数
const SLIDER_MAX_RETRY = numberFromEnv("SHOP_SLIDER_MAX_RETRY", 5);

// 登录总超时（毫秒）
const LOGIN_TIMEOUT_MS = numberFromEnv("SHOP_LOGIN_TIMEOUT_MS", 120 * 1000);

// 选店/切店后等待页面 load 事件（毫秒），再跳转明细页等后续步骤
const DOM_LOAD_TIMEOUT_MS = numberFromEnv(
  "SHOP_DOM_LOAD_TIMEOUT_MS",
  30 * 1000
);

const DEFAULT_ACCOUNTS_JSON_PATH = getProjectConfigPath();

/**
 * 从 config.json 的 emails 字段读取登录邮箱池。
 * 要求：必须是 [{ email, password }, ...]，非空；其它位置不再做兜底。
 */
function getDefaultAccounts() {
  let raw;
  try {
    raw = fs.readFileSync(DEFAULT_ACCOUNTS_JSON_PATH, "utf-8");
  } catch (error) {
    throw new Error(
      `读取 ${DEFAULT_ACCOUNTS_JSON_PATH} 失败: ${error.message || error}`
    );
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${DEFAULT_ACCOUNTS_JSON_PATH} 不是合法 JSON: ${error.message || error}`
    );
  }
  const list = Array.isArray(json?.emails) ? json.emails : [];
  const normalized = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const email = String(item.email || "").trim();
    const password = String(item.password || "").trim();
    if (!email || !password) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    normalized.push({ email, password });
  }
  if (normalized.length === 0) {
    throw new Error(
      `${DEFAULT_ACCOUNTS_JSON_PATH} 缺少有效的 emails 数组，应为 [{ "email": "x@x", "password": "xxx" }, ...]`
    );
  }
  return normalized;
}

const HEADLESS =
  process.env.HEADLESS === "true" || process.env.HEADLESS === "1";

module.exports = {
  SHOP_LOGIN_URL,
  SHOP_HOME_URL,
  ACCOUNTS_DIR,
  BROWSER_VIEWPORT,
  SLIDER_DRAG_DURATION_MS,
  SLIDER_MAX_RETRY,
  LOGIN_TIMEOUT_MS,
  DOM_LOAD_TIMEOUT_MS,
  HEADLESS,
  getDefaultAccounts
};
