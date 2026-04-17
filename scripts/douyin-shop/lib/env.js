const path = require("path");

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

const ACCOUNTS_DIR = path.resolve(
  process.cwd(),
  process.env.SHOP_ACCOUNTS_DIR || "accounts-shop"
);

const BROWSER_VIEWPORT = { width: 1440, height: 900 };

// 滑块拖动总时长（毫秒）
const SLIDER_DRAG_DURATION_MS = numberFromEnv("SHOP_SLIDER_DURATION_MS", 900);

// 每次登录最多重试滑块次数
const SLIDER_MAX_RETRY = numberFromEnv("SHOP_SLIDER_MAX_RETRY", 5);

// 登录总超时（毫秒）
const LOGIN_TIMEOUT_MS = numberFromEnv("SHOP_LOGIN_TIMEOUT_MS", 120 * 1000);

// 选店/切店后等待页面 load 事件（毫秒），再跳转明细页等后续步骤
const DOM_LOAD_TIMEOUT_MS = numberFromEnv(
  "SHOP_DOM_LOAD_TIMEOUT_MS",
  30 * 1000
);

/**
 * 默认账号（支持通过 CLI 传入覆盖）
 * 格式：[{ email, password, name? }]
 */
function getDefaultAccounts() {
  const raw = process.env.SHOP_ACCOUNTS_JSON;
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    } catch (error) {
      console.warn(
        `SHOP_ACCOUNTS_JSON 解析失败，回退默认账号: ${error.message}`
      );
    }
  }
  const email = process.env.SHOP_EMAIL || "lianou_rpa2@163.com";
  const password = process.env.SHOP_PASSWORD || "Lianou123";
  return [{ email, password }];
}

module.exports = {
  numberFromEnv,
  SHOP_LOGIN_URL,
  SHOP_HOME_URL,
  ACCOUNTS_DIR,
  BROWSER_VIEWPORT,
  SLIDER_DRAG_DURATION_MS,
  SLIDER_MAX_RETRY,
  LOGIN_TIMEOUT_MS,
  DOM_LOAD_TIMEOUT_MS,
  getDefaultAccounts
};
