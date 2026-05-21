require("dotenv").config();

const http = require("http");
const path = require("path");
const crypto = require("crypto");
const fse = require("fs-extra");

const HOST = String(process.env.OTP_BRIDGE_HOST || "0.0.0.0").trim();
const PORT = Number.parseInt(process.env.OTP_BRIDGE_PORT || "8787", 10) || 8787;
const ACCESS_TOKEN = String(process.env.OTP_BRIDGE_ACCESS_TOKEN || "").trim();
const PUBLIC_BASE_URL = String(process.env.OTP_BRIDGE_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const SESSION_TTL_MS = Math.max(
  60 * 1000,
  Number.parseInt(process.env.OTP_BRIDGE_SESSION_TTL_MS || String(10 * 60 * 1000), 10) ||
    10 * 60 * 1000
);
const DATA_DIR = path.resolve(
  process.env.OTP_BRIDGE_DATA_DIR || path.join(process.cwd(), "data")
);
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

function nowMs() {
  return Date.now();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOtpCode(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  return /^\d{4,8}$/.test(digits) ? digits : "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isJsonRequest(req) {
  return String(req.headers["content-type"] || "").includes("application/json");
}

function wantsJson(req) {
  const accept = String(req.headers.accept || "").toLowerCase();
  return accept.includes("application/json") || isJsonRequest(req);
}

function getRequestBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || "http";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

function buildPageUrl(req, params = {}) {
  const url = new URL("/", getRequestBaseUrl(req));
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  if (ACCESS_TOKEN) {
    url.searchParams.set("token", ACCESS_TOKEN);
  }
  return url.toString();
}

function buildSessionFile(requestId) {
  return path.join(SESSIONS_DIR, `${requestId}.json`);
}

async function ensureStorage() {
  await fse.ensureDir(SESSIONS_DIR);
}

async function readJsonFile(filePath) {
  try {
    const raw = await fse.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath, data) {
  await fse.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function readSession(requestId) {
  if (!requestId) return null;
  return readJsonFile(buildSessionFile(requestId));
}

async function writeSession(session) {
  await writeJsonFile(buildSessionFile(session.requestId), session);
}

function isExpired(session) {
  return !session || nowMs() > Number(session.expiresAt || 0);
}

function resolveAccessToken(reqUrl, req, body = null) {
  return (
    normalizeText(reqUrl.searchParams.get("token")) ||
    normalizeText(req.headers["x-access-token"]) ||
    normalizeText(String(req.headers.authorization || "").replace(/^Bearer\s+/i, "")) ||
    normalizeText(body?.token)
  );
}

function assertAuthorized(reqUrl, req, body = null) {
  if (!ACCESS_TOKEN) return;
  const provided = resolveAccessToken(reqUrl, req, body);
  if (provided !== ACCESS_TOKEN) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function sendError(res, req, statusCode, message) {
  if (wantsJson(req)) {
    sendJson(res, statusCode, { error: message });
    return;
  }
  sendHtml(
    res,
    statusCode,
    renderPage({
      title: "验证码中转服务",
      status: "error",
      content: `<p>${escapeHtml(message)}</p>`,
    })
  );
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }

      if (isJsonRequest(req)) {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error(`Invalid JSON body: ${error.message}`));
        }
        return;
      }

      const params = new URLSearchParams(raw);
      resolve(Object.fromEntries(params.entries()));
    });
    req.on("error", reject);
  });
}

function renderPage({ title, status = "ready", content }) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        background: #f5f7fb;
        color: #111827;
      }
      .wrap {
        max-width: 560px;
        margin: 0 auto;
        padding: 32px 16px 48px;
      }
      .card {
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(15, 23, 42, 0.08);
        padding: 24px 20px;
      }
      h1 {
        margin: 0 0 16px;
        font-size: 24px;
      }
      p {
        margin: 8px 0;
        line-height: 1.6;
      }
      .meta {
        color: #4b5563;
      }
      .error {
        color: #b91c1c;
      }
      .success {
        color: #047857;
      }
      label {
        display: block;
        margin-top: 16px;
        margin-bottom: 8px;
        font-weight: 600;
      }
      input[type="text"] {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #d1d5db;
        border-radius: 12px;
        font-size: 16px;
        padding: 12px 14px;
      }
      button {
        width: 100%;
        margin-top: 16px;
        border: 0;
        border-radius: 12px;
        background: #2563eb;
        color: #fff;
        font-size: 16px;
        font-weight: 600;
        padding: 12px 16px;
        cursor: pointer;
      }
      .hint {
        margin-top: 12px;
        font-size: 13px;
        color: #6b7280;
      }
      .status {
        margin-bottom: 12px;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="card">
        <div class="status ${escapeHtml(status)}">${escapeHtml(title)}</div>
        ${content}
      </section>
    </main>
  </body>
</html>`;
}

function renderOtpForm({
  accountName,
  maskedPhone,
  reason,
  requestId,
  token,
  title = "抖音验证码填写"
}) {
  const hiddenFields = [
    requestId
      ? `<input type="hidden" name="requestId" value="${escapeHtml(requestId)}" />`
      : "",
    accountName
      ? `<input type="hidden" name="accountName" value="${escapeHtml(accountName)}" />`
      : "",
    maskedPhone
      ? `<input type="hidden" name="maskedPhone" value="${escapeHtml(maskedPhone)}" />`
      : "",
    reason ? `<input type="hidden" name="reason" value="${escapeHtml(reason)}" />` : "",
    token ? `<input type="hidden" name="token" value="${escapeHtml(token)}" />` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return renderPage({
    title,
    content: `
      <h1>${escapeHtml(title)}</h1>
      ${accountName ? `<p class="meta">账号：${escapeHtml(accountName)}</p>` : ""}
      ${maskedPhone ? `<p class="meta">手机号：${escapeHtml(maskedPhone)}</p>` : ""}
      ${reason ? `<p class="meta">说明：${escapeHtml(reason)}</p>` : ""}
      <form method="post" action="/submit">
        ${hiddenFields}
        <label for="otpCode">验证码</label>
        <input id="otpCode" name="otpCode" type="text" inputmode="numeric" maxlength="8" placeholder="请输入 4-8 位数字验证码" required />
        <button type="submit">提交验证码</button>
      </form>
      <p class="hint">该验证码仅绑定当前会话；读取成功后会自动失效。</p>
    `,
  });
}

async function createSession(req, payload) {
  const accountName = normalizeText(payload.accountName);
  if (!accountName) {
    const error = new Error("accountName is required");
    error.statusCode = 400;
    throw error;
  }

  const session = {
    requestId: crypto.randomUUID(),
    accountName,
    maskedPhone: normalizeText(payload.maskedPhone),
    reason: normalizeText(payload.reason),
    createdAt: nowMs(),
    expiresAt: nowMs() + SESSION_TTL_MS,
    submittedAt: null,
    consumedAt: null,
    otpCode: "",
    status: "pending",
  };

  await writeSession(session);

  return {
    requestId: session.requestId,
    entryUrl: buildPageUrl(req, { requestId: session.requestId }),
    expiresAt: session.expiresAt,
    ttlMs: SESSION_TTL_MS,
  };
}

async function submitForSession(session, payload) {
  if (isExpired(session)) {
    const error = new Error("验证码会话已过期，请重新触发。");
    error.statusCode = 410;
    throw error;
  }
  if (session.consumedAt) {
    const error = new Error("验证码已被读取，请重新触发。");
    error.statusCode = 409;
    throw error;
  }

  const otpCode = normalizeOtpCode(payload.otpCode);
  if (!otpCode) {
    const error = new Error("验证码格式错误，请输入 4-8 位数字。");
    error.statusCode = 400;
    throw error;
  }

  const submittedAt = nowMs();
  session.otpCode = otpCode;
  session.submittedAt = submittedAt;
  session.status = "submitted";
  await writeSession(session);

  return {
    ok: true,
    session,
  };
}

async function consumeLatestByRequestId(requestId) {
  const session = await readSession(requestId);
  if (!session || isExpired(session) || session.status !== "submitted" || session.consumedAt) {
    return {
      otpCode: "",
      checkedCount: 0,
      matchedSubjectCount: 0,
      source: "",
    };
  }

  session.consumedAt = nowMs();
  session.status = "consumed";
  await writeSession(session);

  return {
    otpCode: session.otpCode,
    checkedCount: 1,
    matchedSubjectCount: 1,
    source: "otp-bridge-session",
    requestId: session.requestId,
  };
}

async function handleHome(req, res, reqUrl) {
  assertAuthorized(reqUrl, req);

  const requestId = normalizeText(reqUrl.searchParams.get("requestId"));
  const token = normalizeText(reqUrl.searchParams.get("token"));

  if (!requestId) {
    sendHtml(
      res,
      400,
      renderPage({
        title: "缺少验证码会话",
        status: "error",
        content: "<p>当前链接缺少 requestId，请重新从系统推送消息中打开验证码填写页。</p>",
      })
    );
    return;
  }

  const session = await readSession(requestId);
  if (!session) {
    sendHtml(
      res,
      404,
      renderPage({
        title: "验证码会话不存在",
        status: "error",
        content: "<p>链接无效或会话已清理，请重新触发验证码提醒。</p>",
      })
    );
    return;
  }

  if (isExpired(session)) {
    sendHtml(
      res,
      410,
      renderPage({
        title: "验证码会话已过期",
        status: "error",
        content: "<p>该链接已过期，请重新触发验证码提醒。</p>",
      })
    );
    return;
  }

  if (session.consumedAt) {
    sendHtml(
      res,
      200,
      renderPage({
        title: "验证码已处理",
        status: "success",
        content: "<p>该验证码已被读取，无需重复提交。</p>",
      })
    );
    return;
  }

  sendHtml(
    res,
    200,
    renderOtpForm({
      accountName: session.accountName,
      maskedPhone: session.maskedPhone,
      reason: session.reason,
      requestId: session.requestId,
      token,
    })
  );
}

async function handleSubmit(req, res, reqUrl) {
  const body = await parseRequestBody(req);
  assertAuthorized(reqUrl, req, body);

  const requestId = normalizeText(body.requestId);
  if (!requestId) {
    const error = new Error("缺少 requestId，请重新打开验证码填写页。");
    error.statusCode = 400;
    throw error;
  }

  const session = await readSession(requestId);
  if (!session) {
    const error = new Error("验证码会话不存在，请重新打开填写页。");
    error.statusCode = 404;
    throw error;
  }

  await submitForSession(session, body);
  sendHtml(
    res,
    200,
    renderPage({
      title: "提交成功",
      status: "success",
      content: "<p>验证码已提交，请返回等待系统自动读取。</p>",
    })
  );
}

async function handleCreateSession(req, res, reqUrl) {
  const body = await parseRequestBody(req);
  assertAuthorized(reqUrl, req, body);
  const data = await createSession(req, body);
  sendJson(res, 200, data);
}

async function handleLatest(req, res, reqUrl) {
  assertAuthorized(reqUrl, req);

  const requestId = normalizeText(reqUrl.searchParams.get("requestId"));
  if (!requestId) {
    sendJson(res, 400, { error: "requestId is required" });
    return;
  }

  sendJson(res, 200, await consumeLatestByRequestId(requestId));
}

async function handleHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    host: HOST,
    port: PORT,
    dataDir: DATA_DIR,
    sessionTtlMs: SESSION_TTL_MS,
  });
}

async function requestListener(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

  try {
    if (req.method === "GET" && reqUrl.pathname === "/") {
      await handleHome(req, res, reqUrl);
      return;
    }
    if (req.method === "POST" && reqUrl.pathname === "/submit") {
      await handleSubmit(req, res, reqUrl);
      return;
    }
    if (req.method === "POST" && reqUrl.pathname === "/api/session/create") {
      await handleCreateSession(req, res, reqUrl);
      return;
    }
    if (req.method === "GET" && reqUrl.pathname === "/api/latest") {
      await handleLatest(req, res, reqUrl);
      return;
    }
    if (req.method === "GET" && reqUrl.pathname === "/api/health") {
      await handleHealth(req, res);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    console.error("[otp-bridge-public] request failed:", error);
    sendError(res, req, statusCode, error?.message || "Internal Server Error");
  }
}

async function bootstrap() {
  await ensureStorage();
  const server = http.createServer(requestListener);
  server.listen(PORT, HOST, () => {
    console.log(`[otp-bridge-public] listening on http://${HOST}:${PORT}`);
    console.log(`[otp-bridge-public] data dir: ${DATA_DIR}`);
    console.log(`[otp-bridge-public] mode: requestId sessions only`);
  });
}

bootstrap().catch((error) => {
  console.error("[otp-bridge-public] failed to start:", error);
  process.exit(1);
});
