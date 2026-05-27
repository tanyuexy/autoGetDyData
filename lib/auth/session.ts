import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getSessionCookieName, isAppAuthEnabled } from "@/lib/auth/config";
import { SESSION_MAX_AGE_SEC, createSessionToken, parseSessionToken } from "@/lib/auth/sessionToken";

export { createSessionToken, parseSessionToken, SESSION_MAX_AGE_SEC };

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  };
}

export async function getSessionFromCookies(): Promise<{ username: string } | null> {
  if (!isAppAuthEnabled()) return null;
  const store = await cookies();
  const token = store.get(getSessionCookieName())?.value;
  return parseSessionToken(token);
}

export async function getSessionFromRequest(request: NextRequest): Promise<{ username: string } | null> {
  if (!isAppAuthEnabled()) return null;
  const token = request.cookies.get(getSessionCookieName())?.value;
  return parseSessionToken(token);
}
