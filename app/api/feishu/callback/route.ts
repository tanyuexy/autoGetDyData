import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    require("dotenv").config();
    const {
      exchangeCodeForToken,
      writeTokenCache,
    } = require("@/scripts/feishu/lib/oauth");

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code) {
      return new NextResponse(
        '<html><body><h2>授权失败</h2><p>未收到授权码 (code)</p></body></html>',
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    const tokenRecord = await exchangeCodeForToken(code, state || undefined);
    writeTokenCache(tokenRecord);

    return new NextResponse(
      `<html>
        <head><meta charset="utf-8"><title>授权成功</title></head>
        <body style="font-family:sans-serif;text-align:center;padding-top:80px;">
          <h2 style="color:green;">飞书授权成功</h2>
          <p>Token 已保存，可关闭此页面</p>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (e: any) {
    return new NextResponse(
      `<html><body><h2>授权失败</h2><p>${e.message}</p></body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}
