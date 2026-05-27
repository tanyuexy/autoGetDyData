import { NextRequest, NextResponse } from "next/server";
import { readCommentItems } from "@/lib/comment/service";

export async function GET(request: NextRequest) {
  try {
    const accountName = request.nextUrl.searchParams.get("account") || undefined;
    const items = await readCommentItems(accountName);
    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
