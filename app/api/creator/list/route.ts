import { NextResponse } from "next/server";
import { getConfig } from "@/lib/configService";

export async function GET() {
  try {
    const path = require("path");
    const fs = require("fs");
    const { analyzeStorageState, CREATOR_KEY_COOKIE_PATTERNS, readLastVerified } = require("@/app/lib/cookie-checker");

    const config = await getConfig();
    const accounts: string[] = config.accounts || [];

    const ACCOUNTS_DIR = (() => {
      const envVal = process.env.CREATOR_ACCOUNTS_DIR;
      if (envVal) return path.resolve(process.cwd(), envVal);
      const newPath = path.resolve(process.cwd(), "storage/creator-accounts");
      const oldPath = path.resolve(process.cwd(), "accounts");
      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        return oldPath;
      }
      return newPath;
    })();

    const result = await Promise.all(
      accounts.map(async (name: string) => {
        const normalized = String(name || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
        const accountDir = path.join(ACCOUNTS_DIR, normalized);
        const storagePath = path.join(accountDir, "storageState.json");
        const cookiesPath = path.join(accountDir, "cookies.json");
        const exportCfgPath = path.join(accountDir, "creator-export.json");

        let hasStorage = false;
        let hasCookies = false;
        let hasExportDate = false;
        let exportDate: string | null = null;

        const analysis = analyzeStorageState(storagePath, CREATOR_KEY_COOKIE_PATTERNS, 14);
        hasStorage = analysis.status !== "missing";

        const lastVerified = readLastVerified(accountDir);

        let cookieStatus = hasStorage ? analysis.status : "missing";
        let cookieDetail: string | null = hasStorage ? analysis.detail : null;
        const verifiedAtMs = lastVerified.verifiedAt
          ? new Date(lastVerified.verifiedAt).getTime()
          : 0;
        const lastLoginAtMs = analysis.lastLoginAt
          ? new Date(analysis.lastLoginAt).getTime()
          : 0;
        const shouldUseVerifiedResult =
          Boolean(lastVerified.verifiedAt && lastVerified.status) &&
          verifiedAtMs >= lastLoginAtMs;

        if (shouldUseVerifiedResult) {
          cookieStatus = lastVerified.status;
          cookieDetail = lastVerified.detail || analysis.detail;
        }

        try {
          fs.accessSync(cookiesPath);
          hasCookies = true;
        } catch {}
        try {
          const raw = fs.readFileSync(exportCfgPath, "utf-8");
          const cfg = JSON.parse(raw);
          if (cfg?.creatorExportDateStart) {
            hasExportDate = true;
            exportDate = cfg.creatorExportDateStart;
          }
        } catch {}

        return {
          name,
          hasStorageState: hasStorage,
          hasCookies,
          hasExportDateConfig: hasExportDate,
          exportDateStart: exportDate,
          cookieStatus,
          cookieDetail,
          lastLoginAt: analysis.lastLoginAt || null,
          lastVerifiedAt: lastVerified.verifiedAt || null,
        };
      })
    );

    return NextResponse.json({ accounts: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
