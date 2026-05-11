import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import {
  SHOP_KEY_COOKIE_PATTERNS,
  analyzeStorageState,
  mergeVerificationIntoAnalysis,
  readLastVerified,
} from "@/lib/cookie-checker";
import { getConfig } from "@/lib/configService";

export async function GET() {
  try {
    const config = await getConfig();
    const emails: { email: string; password: string }[] = config.emails || [];
    const shopNames = Array.isArray(config.accounts)
      ? config.accounts.map((s: unknown) => String(s || "").trim()).filter(Boolean)
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

        const lastVerified = readLastVerified(accountDir);
        const { cookieStatus, cookieDetail } = mergeVerificationIntoAnalysis(analysis, lastVerified);

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
