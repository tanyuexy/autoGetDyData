import { NextResponse } from "next/server";

export async function GET() {
  try {
    const fs = require("fs");
    const { getFeishuTokenCachePath } = require("@/scripts/feishu/lib/config");

    const cachePath = getFeishuTokenCachePath();

    let hasToken = false;
    let valid = false;
    let expiresAt: string | null = null;

    try {
      const raw = fs.readFileSync(cachePath, "utf-8");
      const data = JSON.parse(raw);
      if (data && data.accessToken) {
        hasToken = true;
        if (data.expiresAt) {
          expiresAt = new Date(data.expiresAt).toISOString();
          valid = Date.now() < data.expiresAt;
        } else if (data.expireTime) {
          const et = Number(data.expireTime) * 1000;
          expiresAt = new Date(et).toISOString();
          valid = Date.now() < et;
        } else {
          valid = true;
        }
      }
    } catch {
      // 无缓存或读失败
    }

    return NextResponse.json({ hasToken, valid, expiresAt });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
