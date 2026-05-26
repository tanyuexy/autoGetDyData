/**
 * 使用已保存的 cookie 登录态打开抖店页面
 *
 * 用法:
 *   node scripts/douyin-shop/commands/open.js <email> [targetUrl]
 */
const { chromium } = require("../../common/stealth-browser");
const { getAccountPaths } = require("../lib/login");
const { SHOP_HOME_URL } = require("../lib/env");
const { retryableGoto, STAGES, detectStage } = require("../lib/page-utils");
const fse = require("fs-extra");

const DEFAULT_TARGET_URL = SHOP_HOME_URL;
const OPEN_READY_TIMEOUT_MS = 90_000;

function normalizeTargetUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return DEFAULT_TARGET_URL;

  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith("jinritemai.com")) {
    throw new Error("targetUrl 只允许 https://*.jinritemai.com 下的页面");
  }
  return url.toString();
}

async function isShopPickerVisible(page) {
  const title = page.locator("text=请选择店铺").first();
  const box = await title.boundingBox().catch(() => null);
  if (!box) return false;
  const viewport = page.viewportSize();
  if (!viewport) {
    return title.isVisible({ timeout: 500 }).catch(() => false);
  }
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height
  );
}

async function focusShopPicker(page) {
  const pickerRoot = page.locator('[class*="roleList"], [class*="roleItem"]').first();
  const hasRoot = await pickerRoot.count().catch(() => 0);
  if (hasRoot > 0) {
    await pickerRoot.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    return;
  }

  const title = page.locator("text=请选择店铺").first();
  if (await title.count().catch(() => 0)) {
    await title.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  }
}

async function waitForInteractiveReady(page) {
  const readyStages = new Set([
    STAGES.FXG_WORKSPACE,
    STAGES.COMPASS_VIDEO,
    STAGES.COMPASS_GRAPHIC,
    STAGES.COMPASS_OTHER,
  ]);
  const deadline = Date.now() + OPEN_READY_TIMEOUT_MS;
  let lastStage = STAGES.UNKNOWN;
  let sawPickerDom = false;

  while (Date.now() < deadline) {
    const hasPickerDom = await page
      .evaluate(() => /请选择店铺/.test(document.body?.innerText || ""))
      .catch(() => false);

    if (hasPickerDom) {
      sawPickerDom = true;
      await focusShopPicker(page);
      if (await isShopPickerVisible(page)) {
        return { stage: STAGES.SHOP_PICKER, url: page.url() || "" };
      }
    }

    const current = await detectStage(page);
    lastStage = current.stage;
    if (readyStages.has(current.stage)) {
      return current;
    }

    await page.waitForTimeout(350);
  }

  if (sawPickerDom) {
    await focusShopPicker(page);
    if (await isShopPickerVisible(page)) {
      return { stage: STAGES.SHOP_PICKER, url: page.url() || "" };
    }
  }

  throw new Error(
    `页面未就绪：等待 ${OPEN_READY_TIMEOUT_MS / 1000}s 后仍未出现「请选择店铺」或工作台（最后 stage=${lastStage}）`
  );
}

let activeBrowser = null;
let activeContext = null;
let shuttingDown = false;
let forceExitTimer = null;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (signal) console.log(`收到 ${signal}，正在关闭抖店浏览器...`);

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
  const email = process.argv[2];
  if (!email) {
    console.error("缺少邮箱");
    process.exit(1);
  }
  const targetUrl = normalizeTargetUrl(process.argv[3]);

  const paths = getAccountPaths(email);
  await fse.ensureDir(paths.accountDir);
  await fse.ensureDir(paths.dataDir);

  const hasAuth = await fse.pathExists(paths.storageStatePath);
  if (!hasAuth) {
    console.error(`账号 ${email} 尚未登录，请先执行登录`);
    process.exit(1);
  }

  console.log(`正在加载账号 [${email}] 的登录态...`);

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"],
  });
  activeBrowser = browser;

  const context = await browser.newContext({
    viewport: null,
    storageState: paths.storageStatePath,
  });
  activeContext = context;

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));

  const page = await context.newPage();
  await retryableGoto(page, targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
    maxRetries: 2,
    baseBackoff: 2500,
    expectedUrlRe: /jinritemai\.com/,
  });

  const settled = await waitForInteractiveReady(page);
  console.log(`页面已就绪: stage=${settled.stage}`);

  console.log(`✓ 已打开抖店页面 - 账号: ${email}`);
  console.log(`  页面: ${targetUrl}`);
  console.log("  关闭浏览器窗口即可退出");

  let shouldExit = false;
  browser.on("disconnected", () => {
    shouldExit = true;
  });
  page.on("close", () => {
    shouldExit = true;
  });

  while (!shouldExit && browser.isConnected()) {
    try {
      const contexts = browser.contexts();
      const allPages = [];
      for (const ctx of contexts) {
        try {
          allPages.push(...ctx.pages());
        } catch {}
      }
      if (allPages.every((p) => {
        try {
          return p.isClosed();
        } catch {
          return true;
        }
      })) {
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
