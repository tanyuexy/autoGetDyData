import { NextRequest, NextResponse } from "next/server";
import { getConfig, saveConfig } from "@/lib/configService";

export async function GET() {
  try {
    const config = await getConfig();
    return NextResponse.json(config);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const data = await request.json();
    await saveConfig(data);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
