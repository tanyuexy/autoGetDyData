import { NextResponse } from "next/server";

export async function POST(request: Request) {
  let browser;
  try {
    const { accountName } = await request.json();
    if (!accountName) {
      return NextResponse.json({ error: "缺少 accountName 参数" }, { status: 400 });
    }

    const path = require("path");
    const fs = require("fs");
    const { chromium } = require("playwright");

    const ACCOUNTS_DIR = (() => {
      const envVal = process.env.CREATOR_ACCOUNTS_DIR;
      if (envVal) return path.resolve(process.cwd(), envVal);
      const newPath = path.resolve(process.cwd(), "storage/creator-accounts");
      const oldPath = path.resolve(process.cwd(), "accounts");
      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) return oldPath;
      return newPath;
    })();

    const normalized = String(accountName).trim().replace(/[\\/:*?"<>|]/g, "_");
    const storagePath = path.join(ACCOUNTS_DIR, normalized, "storageState.json");

    if (!fs.existsSync(storagePath)) {
      return NextResponse.json({
        accountName,
        verified: false,
        status: "missing",
        detail: "未找到 storageState.json 文件",
      });
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      storageState: storagePath,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    const TARGET_URL =
      "https://creator.douyin.com/creator-micro/data-center/content";

    let verified = false;
    let detail = "";
    const start = Date.now();

    try {
      await page.goto(TARGET_URL, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForTimeout(3000);

      const url = page.url() || "";

      // 检查是否在目标页面
      const inTargetPage = url.includes("/creator-micro/data-center/content");

      // 检查是否跳到了登录页
      const isLoginPage = url.includes("login") || url.includes("passport");

      if (isLoginPage) {
        detail = "cookie 已失效 — 页面重定向到登录页";
      } else if (inTargetPage) {
        // 检查是否有「投稿列表」tab
        const hasPostListTab = await page
          .locator("text=投稿列表")
          .first()
          .isVisible({ timeout: 2000 })
          .catch(() => false);

        if (hasPostListTab) {
          verified = true;
          detail = "验证通过 — 检测到投稿列表";
        } else {
          // 检查是否有二维码
          const hasQr = await page
            .locator("text=扫码登录")
            .first()
            .isVisible({ timeout: 1000 })
            .catch(() => false);

          if (hasQr) {
            detail = "cookie 已失效 — 页面显示扫码登录";
          } else {
            detail = "验证不确定 — 在目标页面但未检测到投稿列表";
          }
        }
      } else {
        detail = `验证不确定 — 当前 URL: ${url}`;
      }
    } catch (e: any) {
      detail = `页面加载失败: ${e.message || e}`;
    }

    await context.close();
    const elapsed = Date.now() - start;

    try {
      const vp = path.join(ACCOUNTS_DIR, normalized, "verified-at.json");
      fs.writeFileSync(
        vp,
        JSON.stringify({
          time: Date.now(),
          detail,
          verified,
          status: verified ? "valid" : "expired",
        }),
        "utf-8"
      );
    } catch {}

    return NextResponse.json({
      accountName,
      verified,
      status: verified ? "valid" : "expired",
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
