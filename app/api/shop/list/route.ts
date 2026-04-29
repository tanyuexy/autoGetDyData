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
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      emails = config.emails || [];
    } catch {}

    const ACCOUNTS_DIR = (() => {
      const envVal = process.env.SHOP_ACCOUNTS_DIR;
      if (envVal) return path.resolve(process.cwd(), envVal);
      const newPath = path.resolve(process.cwd(), "storage/shop-accounts");
      const oldPath = path.resolve(process.cwd(), "accounts-shop");
      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        console.warn("[migration] 正在使用旧目录 \"accounts-shop/\"，建议移动到 \"storage/shop-accounts/\" 或设置 SHOP_ACCOUNTS_DIR");
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

    return NextResponse.json({ accounts: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
