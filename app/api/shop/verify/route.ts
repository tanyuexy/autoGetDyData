import { NextResponse } from "next/server";

export async function POST(request: Request) {
  let browser;
  try {
    const { email } = await request.json();
    if (!email) {
      return NextResponse.json({ error: "缺少 email 参数" }, { status: 400 });
    }

    const path = require("path");
    const fs = require("fs");
    const { chromium } = require("playwright");
    const {
      ACCOUNTS_DIR,
      BROWSER_VIEWPORT,
      SHOP_HOME_URL,
    } = require("@/scripts/douyin-shop/lib/env");
    const {
      STAGES,
      isAuthenticatedStage,
      retryableGoto,
      waitForStage,
    } = require("@/scripts/douyin-shop/lib/page-utils");

    const dirName = String(email).trim().replace(/[\\/:*?"<>|]+/g, "_");
    const storagePath = path.join(ACCOUNTS_DIR, dirName, "storageState.json");

    if (!fs.existsSync(storagePath)) {
      return NextResponse.json({
        email,
        verified: false,
        status: "missing",
        detail: "未找到 storageState.json 文件",
      });
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      storageState: storagePath,
      viewport: BROWSER_VIEWPORT,
    });
    const page = await context.newPage();

    let verified = false;
    let detail = "";
    let status: "valid" | "expired" | "warning" = "expired";
    const start = Date.now();

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
    } catch (e: any) {
      status = "warning";
      detail = `页面加载失败: ${e.message || e}`;
    }

    await context.close();
    const elapsed = Date.now() - start;

    // 写入本次浏览器验证结果，下次刷新页面时 list API 会读到。
    try {
      const vp = path.join(ACCOUNTS_DIR, dirName, "verified-at.json");
      fs.writeFileSync(
        vp,
        JSON.stringify({
          time: Date.now(),
          detail,
          verified,
          status,
        }),
        "utf-8"
      );
    } catch {}

    return NextResponse.json({
      email,
      verified,
      status,
      detail,
      elapsed,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "验证失败" },
      { status: 500 }
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
