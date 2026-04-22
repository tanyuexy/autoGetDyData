const fs = require("fs");
const path = require("path");
const { getProjectConfigPath } = require("../../project-config-path");

const DEFAULT_API_BASE = "https://open.feishu.cn";
const DEFAULT_AUTH_BASE = "https://accounts.feishu.cn";
const DEFAULT_SCOPE = "bitable:app offline_access";
const DEFAULT_TOKEN_CACHE_PATH = path.resolve(
  process.cwd(),
  "scripts/feishu/token-cache.json"
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

function readFeishuSectionFromProjectConfig(profile) {
  try {
    const cfgPath = getProjectConfigPath();
    if (!fs.existsSync(cfgPath)) return null;
    const raw = fs.readFileSync(cfgPath, "utf8");
    const data = JSON.parse(raw);
    const feishu = data && data.feishu;
    if (!feishu || typeof feishu !== "object") return null;
    const key =
      profile && String(profile).trim() ? String(profile).trim() : "shop";
    const section = feishu[key];
    if (!section || typeof section !== "object") return null;
    const appToken = String(section.appToken || "").trim();
    const tableId = String(section.tableId || "").trim();
    if (!appToken || !tableId) return null;
    return { appToken, tableId };
  } catch {
    return null;
  }
}

/**
 * OAuth 等与 loadFeishuConfig 相同，但多维表格定位到 config.json / 环境变量下的指定 profile（如 creator、shop）。
 * 用于同一应用下多张表的脚本（例如分别备份抖创表与抖店表）。
 */
function loadFeishuBitableConfigForProfile(profile) {
  const base = loadFeishuConfig();
  const key = String(profile || "shop").trim() || "shop";
  const fromFile = readFeishuSectionFromProjectConfig(key);
  if (fromFile) {
    return {
      ...base,
      bitableAppToken: fromFile.appToken,
      bitableTableId: fromFile.tableId
    };
  }
  const envProfile = optionalEnv("FEISHU_BITABLE_PROFILE", "shop");
  if (key === envProfile) {
    return base;
  }
  throw new Error(
    `无法解析 feishu.${key}：请在项目 config.json 的 feishu.${key} 中填写 appToken 与 tableId，或设置 FEISHU_BITABLE_PROFILE=${key} 及 FEISHU_BITABLE_APP_TOKEN / FEISHU_BITABLE_TABLE_ID`
  );
}

function loadFeishuConfig() {
  let bitableAppToken = optionalEnv("FEISHU_BITABLE_APP_TOKEN", "");
  let bitableTableId = optionalEnv("FEISHU_BITABLE_TABLE_ID", "");
  if (!bitableAppToken || !bitableTableId) {
    const profile = optionalEnv("FEISHU_BITABLE_PROFILE", "shop");
    const fromFile = readFeishuSectionFromProjectConfig(profile);
    if (fromFile) {
      if (!bitableAppToken) bitableAppToken = fromFile.appToken;
      if (!bitableTableId) bitableTableId = fromFile.tableId;
    }
  }

  return {
    appId: requireEnv("FEISHU_OAUTH_APP_ID"),
    appSecret: requireEnv("FEISHU_OAUTH_APP_SECRET"),
    redirectUri: optionalEnv("FEISHU_OAUTH_REDIRECT_URI", ""),
    scope: optionalEnv("FEISHU_OAUTH_SCOPE", DEFAULT_SCOPE),
    apiBase: optionalEnv("FEISHU_API_BASE", DEFAULT_API_BASE),
    authBase: optionalEnv("FEISHU_AUTH_BASE", DEFAULT_AUTH_BASE),
    bitableAppToken,
    bitableTableId,
    tokenCachePath: optionalEnv(
      "FEISHU_OAUTH_TOKEN_CACHE",
      DEFAULT_TOKEN_CACHE_PATH
    )
  };
}

module.exports = {
  loadFeishuConfig,
  loadFeishuBitableConfigForProfile,
  requireEnv,
  optionalEnv
};
