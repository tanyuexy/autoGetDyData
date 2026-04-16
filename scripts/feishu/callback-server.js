#!/usr/bin/env node
require("dotenv").config();

const http = require("http");
const { URL } = require("url");
const { loadFeishuConfig } = require("./lib/config");
const { exchangeCodeForToken, writeTokenCache } = require("./lib/oauth");

function toNumber(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function safeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getServerConfig() {
  const host = String(process.env.FEISHU_OAUTH_CALLBACK_HOST || "127.0.0.1").trim();
  const port = toNumber(process.env.FEISHU_OAUTH_CALLBACK_PORT, 3000);
  const callbackPath = String(
    process.env.FEISHU_OAUTH_CALLBACK_PATH || "/feishu/callback"
  ).trim();
  const normalizedPath = callbackPath.startsWith("/")
    ? callbackPath
    : `/${callbackPath}`;
  const redirectUri = String(process.env.FEISHU_OAUTH_REDIRECT_URI || "").trim();
  const effectiveRedirectUri =
    redirectUri || `http://${host}:${port}${normalizedPath}`;
  const expectedState = String(process.env.FEISHU_OAUTH_EXPECT_STATE || "").trim();
  const autoExit =
    String(process.env.FEISHU_OAUTH_CALLBACK_AUTO_EXIT || "true").trim().toLowerCase() !==
    "false";
  return {
    host,
    port,
    callbackPath: normalizedPath,
    redirectUri: effectiveRedirectUri,
    expectedState,
    autoExit
  };
}

function createServer(config) {
  const feishuConfig = loadFeishuConfig();
  if (!feishuConfig.redirectUri) {
    feishuConfig.redirectUri = config.redirectUri;
  }

  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);

    if (requestUrl.pathname !== config.callbackPath) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Not Found: ${requestUrl.pathname}`);
      return;
    }

    const code = requestUrl.searchParams.get("code") || "";
    const state = requestUrl.searchParams.get("state") || "";
    const error = requestUrl.searchParams.get("error") || "";
    const errorDescription = requestUrl.searchParams.get("error_description") || "";

    if (error) {
      console.error("OAuth 回调失败:", error, errorDescription || "");
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
  <body>
    <h2>飞书 OAuth 回调失败</h2>
    <p>error: <code>${safeText(error)}</code></p>
    <p>error_description: <code>${safeText(errorDescription)}</code></p>
    <p>请回到终端查看错误日志。</p>
  </body>
</html>`);
      return;
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
  <body>
    <h2>未获取到 code</h2>
    <p>请确认飞书应用回调地址配置正确。</p>
  </body>
</html>`);
      return;
    }

    if (config.expectedState && state !== config.expectedState) {
      console.error(
        `OAuth state 校验失败: expected=${config.expectedState}, actual=${state || "<empty>"}`
      );
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
  <body>
    <h2>state 校验失败</h2>
    <p>请回到终端查看错误并重新授权。</p>
  </body>
</html>`);
      return;
    }

    try {
      const tokenRecord = await exchangeCodeForToken(feishuConfig, code);
      await writeTokenCache(feishuConfig.tokenCachePath, tokenRecord);

      console.log("\n=== 收到飞书 OAuth 回调并自动换取 token ===");
      if (state) {
        console.log("state:", state);
      }
      console.log("token 缓存文件:", feishuConfig.tokenCachePath);
      console.log("access_token 到期时间:", new Date(tokenRecord.expiresAt).toISOString());
      console.log("\n现在可以回到终端继续后续操作（token 已可用）。\n");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
  <body>
    <h2>授权成功，token 已保存</h2>
    <p>本地已自动换取并缓存 access token。</p>
    <p>可直接回终端执行 insert。</p>
  </body>
</html>`);

      if (config.autoExit) {
        setTimeout(() => {
          process.exit(0);
        }, 300);
      }
    } catch (exchangeError) {
      console.error("自动 exchange 失败:", exchangeError.message || exchangeError);
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
  <body>
    <h2>授权成功，但换取 token 失败</h2>
    <p>${safeText(exchangeError.message || String(exchangeError))}</p>
    <p>请回到终端查看错误日志。</p>
  </body>
</html>`);
    }
  });
}

function startCallbackServer() {
  const config = getServerConfig();
  const server = createServer(config);
  server.listen(config.port, config.host, () => {
    console.log("飞书 OAuth 回调服务已启动");
    console.log(`监听地址: http://${config.host}:${config.port}${config.callbackPath}`);
    console.log(`请在飞书应用中配置回调地址: ${config.redirectUri}`);
    if (config.expectedState) {
      console.log(`已启用 state 校验: ${config.expectedState}`);
    }
    console.log(
      `自动退出: ${config.autoExit ? "开启" : "关闭"}（FEISHU_OAUTH_CALLBACK_AUTO_EXIT）`
    );
  });
  return server;
}

if (require.main === module) {
  startCallbackServer();
}

module.exports = {
  startCallbackServer
};
