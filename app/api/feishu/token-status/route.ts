import { NextResponse } from "next/server";

export async function GET() {
  try {
    const path = require("path");
    const fs = require("fs");

    // Try to load token cache from the feishu scripts directory
    const cachePath =
      process.env.FEISHU_OAUTH_TOKEN_CACHE ||
      path.resolve(process.cwd(), "scripts/feishu/token-cache.json");

    let hasToken = false;
    let valid = false;
    let expiresAt: string | null = null;

    try {
      const raw = fs.readFileSync(cachePath, "utf-8");
      const data = JSON.parse(raw);
      if (data && data.accessToken) {
        hasToken = true;
        // Check if token has expiry info
        if (data.expiresAt) {
          expiresAt = new Date(data.expiresAt).toISOString();
          valid = Date.now() < data.expiresAt;
        } else if (data.expireTime) {
          // Feishu format: expireTime is seconds timestamp
          const et = Number(data.expireTime) * 1000;
          expiresAt = new Date(et).toISOString();
          valid = Date.now() < et;
        } else {
          // Token exists but no expiry info — assume valid
          valid = true;
        }
      }
    } catch {
      // No token cache
    }

    return NextResponse.json({ hasToken, valid, expiresAt });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
