#!/usr/bin/env node
/**
 * 项目脚本统一入口。请在仓库根目录执行：node run.js <命令> [参数...]
 * npm scripts 已改为调用本文件，工作目录应为项目根（process.cwd()）。
 */
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname);

/** @type {Record<string, { script: string, argv?: string[], env?: Record<string, string> }>} */
const ROUTES = {
  add: { script: "scripts/douyin-creator/index.js", argv: ["add"] },
  export: { script: "scripts/douyin-creator/index.js", argv: ["export"] },
  list: { script: "scripts/douyin-creator/index.js", argv: ["list"] },

  "feishu:auth": { script: "scripts/feishu/index.js", argv: ["auth-url"] },
  "feishu:callback": { script: "scripts/feishu/callback-server.js", argv: [] },
  "feishu:insert-xlsx": {
    script: "scripts/feishu/index.js",
    argv: ["insert-xlsx"]
  },
  "feishu:sync-data-xlsx": {
    script: "scripts/feishu/index.js",
    argv: ["sync-data-xlsx"]
  },
  "feishu:sync-data-xlsx-creator": {
    script: "scripts/feishu/index.js",
    argv: ["sync-data-xlsx"],
    env: { FEISHU_BITABLE_PROFILE: "creator" }
  },

  "shop:login": { script: "scripts/douyin-shop/index.js", argv: ["login"] },
  "shop:list": { script: "scripts/douyin-shop/index.js", argv: ["list"] },
  "shop:merge": { script: "scripts/douyin-shop/index.js", argv: ["merge"] }
};

function printHelp() {
  const names = Object.keys(ROUTES).sort().join(", ");
  console.error(`用法: node run.js <命令> [参数...]
可用命令: ${names}
示例: node run.js add 账号名`);
}

function main() {
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);
  if (!cmd) {
    printHelp();
    process.exit(1);
  }
  const route = ROUTES[cmd];
  if (!route) {
    console.error(`未知命令: ${cmd}`);
    printHelp();
    process.exit(1);
  }

  const scriptPath = path.join(root, route.script);
  const childArgv = [scriptPath, ...(route.argv || []), ...rest];
  const env =
    route.env != null ? { ...process.env, ...route.env } : { ...process.env };

  const result = spawnSync(process.execPath, childArgv, {
    cwd: root,
    stdio: "inherit",
    env
  });
  const code = result.status;
  if (code == null) {
    process.exit(result.signal ? 1 : 0);
  }
  process.exit(code);
}

main();
