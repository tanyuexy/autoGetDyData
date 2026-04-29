import { NextRequest, NextResponse } from "next/server";

export async function POST() {
  try {
    require("dotenv").config();
    const {
      buildAuthorizeUrl,
    } = require("@/scripts/feishu/lib/oauth");

    const url = buildAuthorizeUrl();
    return NextResponse.json({ url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
