#!/usr/bin/env node
require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { loadFeishuConfig, optionalEnv } = require("./lib/config");
const {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  writeTokenCache,
  readTokenCache,
  getValidAccessToken
} = require("./lib/oauth");
const { createBitableRecord } = require("./lib/bitable");

function printHelp() {
  console.log(`
飞书多维表格 OAuth2 工具

用法:
  node scripts/feishu-bitable-oauth/index.js auth-url [--state xxx] [--no-open]
  npm run feishu:callback-server
  node scripts/feishu-bitable-oauth/index.js exchange --code <authorization_code>
  node scripts/feishu-bitable-oauth/index.js refresh
  node scripts/feishu-bitable-oauth/index.js insert --fields '{"姓名":"张三","金额":100}'
  node scripts/feishu-bitable-oauth/index.js insert --fields-file ./data/record.json

说明:
  - auth-url: 生成 OAuth 授权地址（默认自动拉起浏览器，可用 --no-open 关闭）
  - feishu:callback-server: 启动本地回调服务，自动 exchange 并保存 token
  - exchange: 用回调 code 换取 access_token/refresh_token 并写入本地缓存
  - refresh: 强制刷新 access_token
  - insert: 自动检查/刷新 token 后插入一条多维表格记录
`);
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current.startsWith("--")) {
      const key = current.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        result[key] = true;
      } else {
        result[key] = next;
        i += 1;
      }
    } else {
      result._.push(current);
    }
  }
  return result;
}

function readOption(args, ...keys) {
  for (const key of keys) {
    if (args[key] !== undefined) return args[key];
  }
  return undefined;
}

function ensureConfigValue(config, key, envName) {
  const value = config[key];
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`缺少环境变量: ${envName}`);
  }
}

function shouldAutoOpenAuthUrl(args) {
  const explicitNoOpen = Boolean(readOption(args, "no-open", "noOpen"));
  if (explicitNoOpen) return false;
  const explicitOpen = Boolean(readOption(args, "open"));
  if (explicitOpen) return true;
  const envAutoOpen = optionalEnv("FEISHU_OAUTH_AUTH_URL_AUTO_OPEN", "true")
    .trim()
    .toLowerCase();
  return envAutoOpen !== "false";
}

function openUrlInDefaultBrowser(url) {
  return new Promise((resolve, reject) => {
    let cmd = "";
    let args = [];

    if (process.platform === "darwin") {
      cmd = "open";
      args = [url];
    } else if (process.platform === "win32") {
      cmd = "cmd";
      args = ["/c", "start", "", url];
    } else {
      cmd = "xdg-open";
      args = [url];
    }

    const child = spawn(cmd, args, {
      stdio: "ignore",
      detached: true
    });
    child.on("error", reject);
    child.unref();
    resolve();
  });
}

async function readFieldsFromArgs(args) {
  const fieldsFile = readOption(args, "fields-file", "fieldsFile");
  if (fieldsFile) {
    const raw = await fs.readFile(path.resolve(process.cwd(), fieldsFile), "utf8");
    return JSON.parse(raw);
  }
  const inlineFields = readOption(args, "fields");
  if (inlineFields) {
    return JSON.parse(inlineFields);
  }
  const envFields = optionalEnv("FEISHU_INSERT_FIELDS_JSON", "");
  if (envFields) {
    return JSON.parse(envFields);
  }
  throw new Error("请提供 --fields 或 --fields-file，或设置 FEISHU_INSERT_FIELDS_JSON");
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const config = loadFeishuConfig();

  if (command === "auth-url") {
    ensureConfigValue(config, "redirectUri", "FEISHU_OAUTH_REDIRECT_URI");
    const state = String(readOption(args, "state") || "");
    const url = buildAuthorizeUrl(config, state);
    console.log(url);
    if (shouldAutoOpenAuthUrl(args)) {
      try {
        await openUrlInDefaultBrowser(url);
        console.log("已尝试使用默认浏览器打开授权地址。");
      } catch (openError) {
        console.warn("自动打开浏览器失败，请手动复制链接打开。", openError.message || "");
      }
    }
    return;
  }

  if (command === "exchange") {
    ensureConfigValue(config, "redirectUri", "FEISHU_OAUTH_REDIRECT_URI");
    const code = readOption(args, "code");
    if (!code || typeof code !== "string") {
      throw new Error("exchange 需要提供 --code <authorization_code>");
    }
    const tokenRecord = await exchangeCodeForToken(config, code.trim());
    await writeTokenCache(config.tokenCachePath, tokenRecord);
    console.log("授权成功，token 已写入:", config.tokenCachePath);
    console.log("access_token 到期时间:", new Date(tokenRecord.expiresAt).toISOString());
    return;
  }

  if (command === "refresh") {
    const cached = await readTokenCache(config.tokenCachePath);
    if (!cached || !cached.refreshToken) {
      throw new Error("本地没有 refresh_token，请先执行 exchange");
    }
    const tokenRecord = await refreshAccessToken(config, cached.refreshToken);
    await writeTokenCache(config.tokenCachePath, tokenRecord);
    console.log("刷新成功，token 已更新:", config.tokenCachePath);
    console.log("access_token 到期时间:", new Date(tokenRecord.expiresAt).toISOString());
    return;
  }

  if (command === "insert") {
    const fields = await readFieldsFromArgs(args);
    const tokenRecord = await getValidAccessToken(config);
    const data = await createBitableRecord(config, tokenRecord.accessToken, fields);
    const recordId = data && data.record && data.record.record_id;
    console.log("插入成功");
    if (recordId) {
      console.log("record_id:", recordId);
    }
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

run().catch((error) => {
  console.error("执行失败:", error.message || error);
  process.exitCode = 1;
});

