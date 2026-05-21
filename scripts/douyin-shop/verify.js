const fse = require("fs-extra");
/**
 * 抖店 cookie 验证脚本（供 worker 调用）
 * 用法: node scripts/douyin-shop/verify.js <email>
 * 输出: JSON 结果到 stdout（最后一行）
 */

const path = require("path");
const { chromium } = require("../common/stealth-browser");
const {
  ACCOUNTS_DIR,
  BROWSER_VIEWPORT,
  SHOP_HOME_URL,
} = require("./lib/env");
const {
  STAGES,
  isAuthenticatedStage,
  retryableGoto,
  waitForStage,
} = require("./lib/page-utils");

function normalize(name) {
  return String(name || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
}

function output(result) {
  process.stdout.write(JSON.stringify(result) + "\n");
}

async function main() {
  const email = process.argv[2] || "";
  if (!email) {
    output({ verified: false, status: "missing", detail: "缺少 email 参数" });
    process.exit(1);
  }

  const dirName = normalize(email);
  const storagePath = path.join(ACCOUNTS_DIR, dirName, "storageState.json");

  if (!fse.existsSync(storagePath)) {
    output({ email, verified: false, status: "missing", detail: "未找到 storageState.json 文件" });
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: true });
  let verified = false;
  let detail = "";
  let status = "expired";
  const start = Date.now();

  try {
    const context = await browser.newContext({
      storageState: storagePath,
      viewport: BROWSER_VIEWPORT,
    });
    const page = await context.newPage();

    try {
      await retryableGoto(page, SHOP_HOME_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
        maxRetries: 2,
        baseBackoff: 2500,
        expectedUrlRe: /jinritemai\.com/,
      });

      const stage = await waitForStage(
        page,
        [
          STAGES.LOGIN_FORM,
          STAGES.SHOP_PICKER,
          STAGES.COMPASS_VIDEO,
          STAGES.COMPASS_GRAPHIC,
          STAGES.COMPASS_OTHER,
          STAGES.FXG_WORKSPACE,
          STAGES.CAPTCHA,
        ],
        { timeoutMs: 90000, intervalMs: 350 }
      );

      let finalStage = stage;
      if (stage.stage === STAGES.LOGIN_FORM) {
        const authenticatedStage = await waitForStage(
          page,
          [
            STAGES.SHOP_PICKER,
            STAGES.COMPASS_VIDEO,
            STAGES.COMPASS_GRAPHIC,
            STAGES.COMPASS_OTHER,
            STAGES.FXG_WORKSPACE,
          ],
          { timeoutMs: 8000, intervalMs: 250 }
        );
        if (isAuthenticatedStage(authenticatedStage.stage)) {
          finalStage = authenticatedStage;
        }
      }

      if (isAuthenticatedStage(finalStage.stage)) {
        verified = true;
        status = "valid";
        detail = `验证通过 — 阶段=${finalStage.stage}`;
      } else if (finalStage.stage === STAGES.LOGIN_FORM) {
        status = "expired";
        detail = `cookie 已失效 — 页面显示登录表单，url=${finalStage.url}`;
      } else if (finalStage.stage === STAGES.CAPTCHA) {
        status = "warning";
        detail = `验证不确定 — 页面出现滑块验证，url=${finalStage.url}`;
      } else {
        status = "warning";
        detail = `验证不确定 — 阶段=${finalStage.stage}，url=${finalStage.url}`;
      }
    } finally {
      await context.close();
    }

    const elapsed = Date.now() - start;

    try {
      const vp = path.join(ACCOUNTS_DIR, dirName, "verified-at.json");
      fse.writeFileSync(
        vp,
        JSON.stringify({ time: Date.now(), detail, verified, status }),
        "utf-8"
      );
    } catch {}

    output({ email, verified, status, detail, elapsed });
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  output({ verified: false, status: "error", detail: e.message || String(e) });
  process.exit(1);
});
