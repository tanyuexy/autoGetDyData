/**
 * 使用已保存的 cookie 登录态打开抖音创作者中心
 *
 * 用法:
 *   node scripts/douyin-creator/open.js <accountName>
 */
const { chromium } = require("playwright");
const { getAccountPaths } = require("./lib/accounts");
const { fileExists, ensureDir } = require("../common/fs");
const { BROWSER_VIEWPORT } = require("./lib/env");

let activeBrowser = null;
let activeContext = null;
let shuttingDown = false;
let forceExitTimer = null;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (signal) console.log(`收到 ${signal}，正在关闭浏览器...`);

  forceExitTimer = setTimeout(() => {
    console.error("浏览器关闭超时（5秒），强制退出进程");
    process.exit(1);
  }, 5000);
  if (forceExitTimer.unref) forceExitTimer.unref();

  try {
    if (activeContext) {
      await activeContext.close().catch(() => {});
    }
    if (activeBrowser && activeBrowser.isConnected()) {
      await activeBrowser.close().catch(() => {});
    }
  } finally {
    if (forceExitTimer) clearTimeout(forceExitTimer);
    process.exit(signal === "SIGTERM" ? 143 : 0);
  }
}

async function main() {
  const accountName = process.argv[2];
  if (!accountName) {
    console.error("缺少账号名");
    process.exit(1);
  }

  const paths = getAccountPaths(accountName);
  await ensureDir(paths.accountDir);
  await ensureDir(paths.dataDir);
  await ensureDir(paths.alertDir);

  const hasAuth = await fileExists(paths.storageStatePath);
  if (!hasAuth) {
    console.error(`账号 ${accountName} 尚未登录，请先执行登录`);
    process.exit(1);
  }

  console.log(`正在加载账号 [${accountName}] 的登录态...`);

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"]
  });
  activeBrowser = browser;

  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    storageState: paths.storageStatePath
  });
  activeContext = context;

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));

  const page = await context.newPage();
  await page.goto(
    "https://creator.douyin.com/creator-micro/data-center/content",
    {
      waitUntil: "domcontentloaded",
      timeout: 30000
    }
  );
  await page.waitForTimeout(3000);

  console.log(`✓ 已打开抖音创作者中心 - 账号: ${accountName}`);
  console.log("  关闭浏览器窗口即可退出");

  let shouldExit = false;
  browser.on("disconnected", () => { shouldExit = true; });
  page.on("close", () => { shouldExit = true; });

  while (!shouldExit && browser.isConnected()) {
    try {
      const contexts = browser.contexts();
      const allPages = [];
      for (const ctx of contexts) {
        try { allPages.push(...ctx.pages()); } catch {}
      }
      if (allPages.every((p) => { try { return p.isClosed(); } catch { return true; } })) {
        shouldExit = true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("浏览器已关闭，退出");
  await shutdown();
}

main().catch((e) => {
  console.error("打开失败:", e.message);
  process.exit(1);
});
