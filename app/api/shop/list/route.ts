import { NextResponse } from "next/server";
import { getConfig } from "@/lib/configService";

export async function GET() {
  try {
    const path = require("path");
    const fs = require("fs");
    const { analyzeStorageState, SHOP_KEY_COOKIE_PATTERNS, readLastVerified } = require("@/app/lib/cookie-checker");

    const config = await getConfig();
    const emails: { email: string; password: string }[] = config.emails || [];
    const shopNames = Array.isArray(config.accounts)
      ? config.accounts.map((s: any) => String(s || "").trim()).filter(Boolean)
      : [];

    const ACCOUNTS_DIR = (() => {
      const envVal = process.env.SHOP_ACCOUNTS_DIR;
      if (envVal) return path.resolve(process.cwd(), envVal);
      const newPath = path.resolve(process.cwd(), "storage/shop-accounts");
      const oldPath = path.resolve(process.cwd(), "accounts-shop");
      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        return oldPath;
      }
      return newPath;
    })();

    const result = await Promise.all(
      emails.map(async (entry: { email: string; password: string }) => {
        const dirName = String(entry.email || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
        const accountDir = path.join(ACCOUNTS_DIR, dirName);
        const storagePath = path.join(accountDir, "storageState.json");

        const analysis = analyzeStorageState(storagePath, SHOP_KEY_COOKIE_PATTERNS, 14);
        const hasStorage = analysis.status !== "missing";

        // 最近 24h 内浏览器验证通过的，覆盖 cookie 静态分析结果
        const lastVerified = readLastVerified(accountDir);

        let cookieStatus = hasStorage ? analysis.status : "missing";
        let cookieDetail: string | null = hasStorage ? analysis.detail : null;

        if (lastVerified.verifiedAt) {
          cookieStatus = "valid";
          cookieDetail = lastVerified.detail || analysis.detail;
        }

        return {
          email: entry.email,
          password: entry.password,
          hasStorageState: hasStorage,
          cookieStatus,
          cookieDetail,
          lastLoginAt: analysis.lastLoginAt || null,
          lastVerifiedAt: lastVerified.verifiedAt || null,
        };
      })
    );

    return NextResponse.json({ accounts: result, shopNames });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
