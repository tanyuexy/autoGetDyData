#!/usr/bin/env node
/**
 * 项目脚本统一入口。请在仓库根目录执行：node scripts/run.js <命令> [参数...]
 * npm scripts 与 Next API 都应调用本文件，避免散落依赖具体脚本路径。
 */
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");

/** @type {Record<string, { script: string, argv?: string[], env?: Record<string, string> }>} */
const ROUTES = {
  "creator:export": {
    script: "scripts/douyin-creator/index.js",
    argv: ["export"]
  },
  "creator:export-feishu": {
    script: "scripts/douyin-creator/index.js",
    argv: ["export:feishu"]
  },
  "creator:list": {
    script: "scripts/douyin-creator/index.js",
    argv: ["list"]
  },
  "creator:publish-video": {
    script: "scripts/douyin-creator/index.js",
    argv: ["publish-video"]
  },
  "creator:publish-article": {
    script: "scripts/douyin-creator/index.js",
    argv: ["publish-article"]
  },
  "creator:login": {
    script: "scripts/douyin-creator/index.js",
    argv: ["login"]
  },

  export: { script: "scripts/douyin-creator/index.js", argv: ["export"] },
  "export:feishu": {
    script: "scripts/douyin-creator/index.js",
    argv: ["export:feishu"]
  },

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
  "feishu:sync-data-xlsx-shop": {
    script: "scripts/feishu/index.js",
    argv: ["sync-data-xlsx-shop"],
    env: { FEISHU_BITABLE_PROFILE: "shop" }
  },
  "feishu:sync-creator": {
    script: "scripts/feishu/index.js",
    argv: ["sync-data-xlsx"],
    env: { FEISHU_BITABLE_PROFILE: "creator" }
  },
  "feishu:sync-shop": {
    script: "scripts/feishu/index.js",
    argv: ["sync-data-xlsx-shop"],
    env: { FEISHU_BITABLE_PROFILE: "shop" }
  },
  "feishu:backup-bitable": {
    script: "scripts/feishu/index.js",
    argv: ["backup-bitable"]
  },
  "feishu:backup": {
    script: "scripts/feishu/index.js",
    argv: ["backup-bitable"]
  },
  "feishu:import-publish-tasks": {
    script: "scripts/feishu/import-publish-tasks.js",
    argv: []
  },

  "shop:login": { script: "scripts/douyin-shop/index.js", argv: ["login"] },
  "shop:export": { script: "scripts/douyin-shop/index.js", argv: ["export"] },
  "shop:merge": { script: "scripts/douyin-shop/index.js", argv: ["merge"] },
  "shop:feishu-sync": {
    script: "scripts/douyin-shop/index.js",
    argv: ["feishu-sync"]
  },
  "shop:sync-feishu": {
    script: "scripts/douyin-shop/index.js",
    argv: ["sync-feishu"]
  }
};

function printHelp() {
  const names = Object.keys(ROUTES).sort().join(", ");
  console.error(`用法: node scripts/run.js <命令> [参数...]
可用命令: ${names}
示例: node scripts/run.js creator:export`);
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

  const scriptPath = path.join(projectRoot, route.script);
  const childArgv = [scriptPath, ...(route.argv || []), ...rest];
  const env =
    route.env != null ? { ...process.env, ...route.env } : { ...process.env };

  const result = spawnSync(process.execPath, childArgv, {
    cwd: projectRoot,
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
