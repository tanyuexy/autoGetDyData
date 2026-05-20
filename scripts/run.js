#!/usr/bin/env node
/**
 * 页面/API 使用的脚本统一入口。
 * 这里只保留当前 Web 页面会触发的能力，命令行专用历史入口不再暴露。
 */
const path = require("path");
const { spawnSync } = require("child_process");
const { MongoClient } = require("mongodb");

const projectRoot = path.resolve(__dirname, "..");

/** @type {Record<string, { script: string, argv?: string[], env?: Record<string, string> }>} */
const ROUTES = {
  "creator:export": {
    script: "scripts/douyin-creator/cli.js",
    argv: ["export"]
  },
  "creator:export-feishu": {
    script: "scripts/douyin-creator/cli.js",
    argv: ["export:feishu"]
  },
  "creator:publish-video": {
    script: "scripts/douyin-creator/cli.js",
    argv: ["publish-video"]
  },
  "creator:publish-article": {
    script: "scripts/douyin-creator/cli.js",
    argv: ["publish-article"]
  },
  "creator:login": {
    script: "scripts/douyin-creator/cli.js",
    argv: ["login"]
  },
  "creator:open": {
    script: "scripts/douyin-creator/commands/open.js",
    argv: []
  },
  "creator:review": {
    script: "scripts/douyin-creator/commands/review.js",
    argv: []
  },
  "creator:comment": {
    script: "scripts/douyin-creator/commands/comment.js",
    argv: []
  },
  "creator:reply-comment": {
    script: "scripts/douyin-creator/commands/reply-comment.js",
    argv: []
  },
  "creator:verify": {
    script: "scripts/douyin-creator/commands/verify.js",
    argv: []
  },

  "shop:login": {
    script: "scripts/douyin-shop/cli.js",
    argv: ["login"]
  },
  "shop:export": {
    script: "scripts/douyin-shop/cli.js",
    argv: ["export"]
  },
  "shop:sync-feishu": {
    script: "scripts/douyin-shop/cli.js",
    argv: ["sync-feishu"]
  },
  "shop:retry-failed": {
    script: "scripts/douyin-shop/cli.js",
    argv: ["retry-failed"]
  },
  "shop:verify": {
    script: "scripts/douyin-shop/verify.js",
    argv: []
  },

};

function printHelp() {
  const names = Object.keys(ROUTES).sort().join(", ");
  console.error(`用法: node scripts/run.js <命令> [参数...]
可用命令: ${names}
示例: node scripts/run.js creator:export`);
}

async function loadProjectConfigJson() {
  if (process.env.PROJECT_CONFIG_JSON) return process.env.PROJECT_CONFIG_JSON;
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || "autoGetDyData");
    const config = await db.collection("app_config").findOne({ _id: "default" });
    return JSON.stringify(config || {});
  } finally {
    await client.close().catch(() => {});
  }
}

async function main() {
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
  const env = route.env ? { ...process.env, ...route.env } : { ...process.env };
  env.PROJECT_CONFIG_JSON = await loadProjectConfigJson();

  let killed = false;
  process.on("SIGTERM", () => {
    if (!killed) {
      killed = true;
    }
  });
  process.on("SIGINT", () => {
    if (!killed) {
      killed = true;
    }
  });

  const result = spawnSync(process.execPath, childArgv, {
    cwd: projectRoot,
    stdio: "inherit",
    env
  });

  if (killed) {
    process.exit(143);
  }
  if (result.status == null) {
    process.exit(result.signal ? 1 : 0);
  }
  process.exit(result.status);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
