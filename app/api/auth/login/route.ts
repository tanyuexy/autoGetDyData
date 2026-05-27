import { NextRequest, NextResponse } from "next/server";
import { isAppAuthEnabled, verifyAppCredentials } from "@/lib/auth/config";
import { getSessionCookieName } from "@/lib/auth/config";
import { createSessionToken, getSessionCookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!isAppAuthEnabled()) {
      return NextResponse.json({ error: "未配置 APP_AUTH_USERS，登录功能未启用" }, { status: 503 });
    }
    const body = await request.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) {
      return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
    }
    if (!verifyAppCredentials(username, password)) {
      return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
    }
    const token = await createSessionToken(username);
    const response = NextResponse.json({ ok: true, username });
    response.cookies.set(getSessionCookieName(), token, getSessionCookieOptions());
    return response;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "登录失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
