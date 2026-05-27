import { NextResponse } from "next/server";
import { isAppAuthEnabled } from "@/lib/auth/config";
import { getSessionFromCookies } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET() {
  if (!isAppAuthEnabled()) {
    return NextResponse.json({ enabled: false, username: null });
  }
  const session = await getSessionFromCookies();
  if (!session?.username) {
    return NextResponse.json({ enabled: true, username: null }, { status: 401 });
  }
  return NextResponse.json({ enabled: true, username: session.username });
}
