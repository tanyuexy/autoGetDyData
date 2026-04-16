const path = require("path");

const DEFAULT_API_BASE = "https://open.feishu.cn";
const DEFAULT_AUTH_BASE = "https://accounts.feishu.cn";
const DEFAULT_SCOPE = "bitable:app";
const DEFAULT_TOKEN_CACHE_PATH = path.resolve(
  process.cwd(),
  "scripts/feishu-bitable-oauth/token-cache.json"
);

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`缺少环境变量: ${name}`);
  }
  return String(value).trim();
}

function optionalEnv(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  return trimmed || fallback;
}

function loadFeishuConfig() {
  return {
    appId: requireEnv("FEISHU_OAUTH_APP_ID"),
    appSecret: requireEnv("FEISHU_OAUTH_APP_SECRET"),
    redirectUri: optionalEnv("FEISHU_OAUTH_REDIRECT_URI", ""),
    scope: optionalEnv("FEISHU_OAUTH_SCOPE", DEFAULT_SCOPE),
    apiBase: optionalEnv("FEISHU_API_BASE", DEFAULT_API_BASE),
    authBase: optionalEnv("FEISHU_AUTH_BASE", DEFAULT_AUTH_BASE),
    bitableAppToken: optionalEnv("FEISHU_BITABLE_APP_TOKEN", ""),
    bitableTableId: optionalEnv("FEISHU_BITABLE_TABLE_ID", ""),
    tokenCachePath: optionalEnv(
      "FEISHU_OAUTH_TOKEN_CACHE",
      DEFAULT_TOKEN_CACHE_PATH
    )
  };
}

module.exports = {
  loadFeishuConfig,
  requireEnv,
  optionalEnv
};
