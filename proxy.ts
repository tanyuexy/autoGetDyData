import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookieName, isAppAuthEnabled } from "./lib/auth/config";
import { isInternalApiRequest } from "./lib/auth/internalApi";
import { parseSessionToken } from "./lib/auth/sessionToken";

const PUBLIC_PAGE_PATHS = new Set(["/login"]);
const PUBLIC_API_PREFIXES = ["/api/auth/login", "/api/feishu/callback"];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function hasValidSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(getSessionCookieName())?.value;
  const session = await parseSessionToken(token);
  return Boolean(session?.username);
}

export async function proxy(request: NextRequest) {
  if (!isAppAuthEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  if (isPublicApi(pathname) || isInternalApiRequest(request)) {
    return NextResponse.next();
  }

  if (PUBLIC_PAGE_PATHS.has(pathname)) {
    if (await hasValidSession(request)) {
      const url = request.nextUrl.clone();
      url.pathname = "/creator";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!(await hasValidSession(request))) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
