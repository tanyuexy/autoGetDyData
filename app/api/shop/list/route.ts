import { NextResponse } from "next/server";

export async function GET() {
  try {
    const path = require("path");
    const fs = require("fs");
    const { getProjectConfigPath } = require("@/scripts/project-config-path");

    const configPath =
      process.env.PROJECT_CONFIG_PATH ||
      process.env.ADD_ACCOUNTS_JSON ||
      getProjectConfigPath();

    let emails: { email: string; password: string }[] = [];
    let shopNames: string[] = [];
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      emails = config.emails || [];
      shopNames = Array.isArray(config.accounts)
        ? config.accounts.map((s: any) => String(s || "").trim()).filter(Boolean)
        : [];
    } catch {}

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
        const storagePath = path.join(ACCOUNTS_DIR, dirName, "storageState.json");
        let hasStorage = false;
        try {
          fs.accessSync(storagePath);
          hasStorage = true;
        } catch {}

        return {
          email: entry.email,
          password: entry.password,
          hasStorageState: hasStorage,
        };
      })
    );

    return NextResponse.json({ accounts: result, shopNames });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
