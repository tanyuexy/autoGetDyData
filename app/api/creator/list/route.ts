import path from "path";
import { NextResponse } from "next/server";
import fse from "fs-extra";
import {
  CREATOR_KEY_COOKIE_PATTERNS,
  analyzeStorageState,
  mergeVerificationIntoAnalysis,
  readLastVerified,
} from "@/lib/cookie-checker";
import { getConfig } from "@/lib/configService";

export async function GET() {
  try {
    const config = await getConfig();
    const accounts: string[] = config.accounts || [];

    const ACCOUNTS_DIR = (() => {
      const envVal = process.env.CREATOR_ACCOUNTS_DIR;
      if (envVal) return path.resolve(process.cwd(), envVal);
      const newPath = path.resolve(process.cwd(), "storage/creator-accounts");
      const oldPath = path.resolve(process.cwd(), "accounts");
      if (fse.existsSync(oldPath) && !fse.existsSync(newPath)) {
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

        let hasCookies = false;
        let hasExportDate = false;
        let exportDate: string | null = null;

        const analysis = analyzeStorageState(storagePath, CREATOR_KEY_COOKIE_PATTERNS, 14);
        const hasStorage = analysis.status !== "missing";

        const lastVerified = readLastVerified(accountDir);
        const { cookieStatus, cookieDetail } = mergeVerificationIntoAnalysis(analysis, lastVerified);

        try {
          fse.accessSync(cookiesPath);
          hasCookies = true;
        } catch {}
        try {
          const raw = fse.readFileSync(exportCfgPath, "utf-8");
          const cfg = JSON.parse(raw) as { creatorExportDateStart?: string };
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
