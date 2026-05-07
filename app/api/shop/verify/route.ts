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

    const ACCOUNTS_DIR = (() => {
      const envVal = process.env.SHOP_ACCOUNTS_DIR;
      if (envVal) return path.resolve(process.cwd(), envVal);
      const newPath = path.resolve(process.cwd(), "storage/shop-accounts");
      const oldPath = path.resolve(process.cwd(), "accounts-shop");
      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) return oldPath;
      return newPath;
    })();

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
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    const SHOP_HOME_URL =
      process.env.SHOP_HOME_URL ||
      "https://fxg.jinritemai.com/ffa/mshop/home/index";

    let verified = false;
    let detail = "";
    const start = Date.now();

    try {
      await page.goto(SHOP_HOME_URL, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      // 检查是否跳转到登录页
      const url = page.url() || "";
      const isLoginPage =
        url.includes("/login/") || url.includes("/passport/");

      if (isLoginPage) {
        detail = "cookie 已失效 — 页面重定向到登录页";
      } else {
        // 检查是否有登录密码框（说明登录表单出现了）
        const hasPasswordInput = await page
          .locator('input[type="password"]')
          .first()
          .isVisible({ timeout: 300 })
          .catch(() => false);

        if (hasPasswordInput) {
          // 进一步确认是否有邮箱/手机登录相关 UI
          const hasLoginUi = await page
            .locator('div[role="tab"]:has-text("邮箱登录"), text=手机号登录')
            .first()
            .isVisible({ timeout: 300 })
            .catch(() => false);
          if (hasLoginUi) {
            detail = "cookie 已失效 — 页面显示了登录表单";
          } else {
            // 可能只是在其他页面有个 password input（如修改密码）
            verified = true;
            detail = "验证通过（无登录表单）";
          }
        } else {
          // 检查是否有工作台 DOM 特征
          const hasWorkspaceDom =
            (await page
              .locator('div[class*="userDropDown"], [class*="shopName"], [class*="shopTitle"]')
              .first()
              .isVisible({ timeout: 1000 })
              .catch(() => false));

          if (hasWorkspaceDom) {
            verified = true;
            detail = "验证通过 — 检测到工作台界面";
          } else {
            const isCompassUrl = url.includes("compass.jinritemai.com");
            if (isCompassUrl) {
              const hasCompassDom = await page
                .locator('text=短视频明细, text=视频明细, [class*="ecom-"]')
                .first()
                .isVisible({ timeout: 1500 })
                .catch(() => false);
              if (hasCompassDom) {
                verified = true;
                detail = "验证通过 — 检测到罗盘界面";
              } else {
                detail = `验证不确定 — URL: ${url}，未检测到明显登录特征`;
              }
            } else {
              detail = `验证不确定 — 当前 URL: ${url}`;
            }
          }
        }
      }
    } catch (e: any) {
      detail = `页面加载失败: ${e.message || e}`;
    }

    await context.close();
    const elapsed = Date.now() - start;

    // 验证通过时写入验证结果，下次刷新页面时 list API 会读到
    if (verified) {
      try {
        const vp = path.join(ACCOUNTS_DIR, dirName, "verified-at.json");
        fs.writeFileSync(
          vp,
          JSON.stringify({ time: Date.now(), detail }),
          "utf-8"
        );
      } catch {}
    }

    return NextResponse.json({
      email,
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
