/**
 * 使用已保存的 cookie 登录态打开抖音创作者中心
 *
 * 用法:
 *   node scripts/douyin-creator/open.js <accountName>
 */
const { chromium } = require("playwright");
const { getAccountPaths } = require("./lib/accounts");
const { fileExists, ensureDir } = require("./lib/fs-utils");
const { BROWSER_VIEWPORT } = require("./lib/env");

let activeBrowser = null;
let activeContext = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，正在关闭浏览器...`);
  try {
    if (activeContext) await activeContext.close().catch(() => {});
    if (activeBrowser) await activeBrowser.close().catch(() => {});
  } finally {
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
    args: ["--start-maximized"],
  });
  activeBrowser = browser;

  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    storageState: paths.storageStatePath,
  });
  activeContext = context;

  const page = await context.newPage();
  await page.goto("https://creator.douyin.com/creator-micro/data-center/content", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  console.log(`✓ 已打开抖音创作者中心 - 账号: ${accountName}`);
  console.log("  关闭浏览器窗口即可退出");

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));
  browser.on("disconnected", () => {
    console.log("浏览器已关闭，退出");
    process.exit(0);
  });

  await new Promise(() => {});
}

main().catch((e) => {
  console.error("打开失败:", e.message);
  process.exit(1);
});
