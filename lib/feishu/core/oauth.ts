// @ts-nocheck
import fse from "fs-extra";
import path from "node:path";

function normalizeScope(scopeText) {
  const scopes = String(scopeText || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!scopes.includes("offline_access")) {
    scopes.push("offline_access");
  }
  return Array.from(new Set(scopes)).join(" ");
}

function buildAuthorizeUrl(config, state = "") {
  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    scope: normalizeScope(config.scope)
  });
  if (state) {
    params.set("state", state);
  }
  return `${config.authBase}/open-apis/authen/v1/authorize?${params.toString()}`;
}

async function postFeishuJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`飞书接口返回非 JSON: ${text || "<empty>"}`);
  }

  if (!response.ok) {
    throw new Error(
      `飞书接口 HTTP ${response.status}: ${parsed.msg || text || "未知错误"}`
    );
  }
  if (typeof parsed.code === "number" && parsed.code !== 0) {
    throw new Error(`飞书接口错误 code=${parsed.code}, msg=${parsed.msg || "未知错误"}`);
  }
  return parsed.data || parsed;
}

function toTokenRecord(data) {
  const now = Date.now();
  const expiresInSec = Number(data.expires_in || 0);
  const refreshExpiresInSec = Number(
    data.refresh_token_expires_in || data.refresh_expires_in || 0
  );
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenType: data.token_type || "Bearer",
    scope: data.scope || "",
    expiresInSec,
    refreshExpiresInSec,
    expiresAt: expiresInSec > 0 ? now + expiresInSec * 1000 : 0,
    refreshExpiresAt: refreshExpiresInSec > 0 ? now + refreshExpiresInSec * 1000 : 0,
    raw: data
  };
}

async function exchangeCodeForToken(config, code) {
  const data = await postFeishuJson(
    `${config.apiBase}/open-apis/authen/v2/oauth/token`,
    {
      grant_type: "authorization_code",
      code,
      client_id: config.appId,
      client_secret: config.appSecret,
      redirect_uri: config.redirectUri
    }
  );
  return toTokenRecord(data);
}

async function refreshAccessToken(config, refreshToken) {
  const data = await postFeishuJson(
    `${config.apiBase}/open-apis/authen/v2/oauth/token`,
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.appId,
      client_secret: config.appSecret
    }
  );
  return toTokenRecord(data);
}

async function readTokenCache(tokenCachePath) {
  try {
    const raw = await fse.readFile(tokenCachePath, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeTokenCache(tokenCachePath, tokenRecord) {
  await fse.ensureDir(path.dirname(tokenCachePath));
  await fse.writeFile(
    tokenCachePath,
    JSON.stringify(
      {
        ...tokenRecord,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
}

async function getValidAccessToken(config) {
  const cache = await readTokenCache(config.tokenCachePath);
  if (!cache || !cache.accessToken) {
    throw new Error("本地没有可用 token，请先执行 exchange 授权。");
  }

  const now = Date.now();
  const thresholdMs = 2 * 60 * 1000;
  if (cache.expiresAt && cache.expiresAt > now + thresholdMs) {
    return cache;
  }
  if (!cache.refreshToken) {
    throw new Error("access token 已过期，且无 refresh_token。请重新执行 exchange。");
  }

  const refreshed = await refreshAccessToken(config, cache.refreshToken);
  await writeTokenCache(config.tokenCachePath, refreshed);
  return refreshed;
}

export {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  readTokenCache,
  writeTokenCache,
  getValidAccessToken,
};
