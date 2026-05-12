import { NextRequest, NextResponse } from "next/server";
import { readReviewItems } from "@/lib/reviewService";

export async function GET(request: NextRequest) {
  try {
    const accountName = request.nextUrl.searchParams.get("account") || undefined;
    const items = await readReviewItems(accountName);
    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
