/**
 * 抖创 cookie 验证脚本（供 worker 调用）
 * 用法: node scripts/douyin-creator/commands/verify.js <accountName>
 * 输出: JSON 结果到 stdout（最后一行）
 */

const path = require("path");
const fs = require("fs");
const { chromium } = require("../../common/stealth-browser");
const { getAccountPaths } = require("../core/accounts");
const { BROWSER_VIEWPORT, TARGET_URL } = require("../core/env");
const { isLoggedInAtTarget } = require("../core/browser-login");

function normalize(name) {
  return String(name || "").trim().replace(/[\\/:*?"<>|]/g, "_");
}

function output(result) {
  process.stdout.write(JSON.stringify(result) + "\n");
}

async function main() {
  const accountName = normalize(process.argv[2] || "");
  if (!accountName) {
    output({ verified: false, status: "missing", detail: "缺少 accountName 参数" });
    process.exit(1);
  }

  const paths = getAccountPaths(accountName);

  if (!fs.existsSync(paths.storageStatePath)) {
    output({ accountName, verified: false, status: "missing", detail: "未找到 storageState.json 文件" });
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: true });
  let detail = "";
  let verified = false;
  let status = "expired";
  const start = Date.now();

  try {
    const context = await browser.newContext({
      storageState: paths.storageStatePath,
      viewport: BROWSER_VIEWPORT,
    });
    const page = await context.newPage();

    try {
      await page.goto(TARGET_URL, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForTimeout(3000);

      const url = page.url() || "";
      const isLoginPage = url.includes("login") || url.includes("passport");
      const loggedIn = await isLoggedInAtTarget(page).catch(() => false);

      if (isLoginPage) {
        detail = "cookie 已失效 — 页面重定向到登录页";
      } else if (loggedIn) {
        verified = true;
        status = "valid";
        detail = "验证通过 — 检测到创作者中心已登录";
      } else {
        detail = `验证不确定 — 当前 URL: ${url}`;
      }
    } finally {
      await context.close();
    }

    const elapsed = Date.now() - start;

    try {
      const vp = path.join(paths.accountDir, "verified-at.json");
      fs.writeFileSync(
        vp,
        JSON.stringify({ time: Date.now(), detail, verified, status }),
        "utf-8"
      );
    } catch {}

    output({ accountName, verified, status, detail, elapsed });
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  output({ verified: false, status: "error", detail: e.message || String(e) });
  process.exit(1);
});
