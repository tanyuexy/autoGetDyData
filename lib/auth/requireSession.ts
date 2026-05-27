import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAppAuthEnabled } from "@/lib/auth/config";
import { isInternalApiRequest } from "@/lib/auth/internalApi";
import { getSessionFromRequest } from "@/lib/auth/session";

export type AppSession = { username: string };

export { isInternalApiRequest };

/** API 路由：未登录时返回 401 JSON */
export async function requireAppSession(request: NextRequest): Promise<AppSession | NextResponse> {
  if (!isAppAuthEnabled()) {
    return { username: "" };
  }
  if (isInternalApiRequest(request)) {
    return { username: "" };
  }
  const session = await getSessionFromRequest(request);
  if (!session?.username) {
    return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
  }
  return session;
}

export function resolveOwnerUsername(session: AppSession): string | undefined {
  const name = session.username?.trim();
  return name || undefined;
}
