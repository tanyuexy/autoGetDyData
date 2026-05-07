import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { getProjectConfigPath } = require("@/scripts/project-config-path");
    const path = require("path");
    const fs = require("fs");
    const { analyzeStorageState, CREATOR_KEY_COOKIE_PATTERNS, readLastVerified } = require("@/app/lib/cookie-checker");

    const configPath =
      process.env.PROJECT_CONFIG_PATH ||
      process.env.ADD_ACCOUNTS_JSON ||
      getProjectConfigPath();

    let accounts: string[] = [];
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      accounts = config.accounts || [];
    } catch {}

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

        if (lastVerified.verifiedAt) {
          cookieStatus = "valid";
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
