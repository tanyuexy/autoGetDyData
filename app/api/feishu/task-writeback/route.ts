import { NextRequest, NextResponse } from "next/server";
import { markFeishuTaskPublished, writeFeishuTaskStatus } from "@/lib/feishu/service";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const action = String(body?.action || "").trim();
    const recordId = String(body?.recordId || "").trim();

    if (!recordId) {
      return NextResponse.json({ error: "missing recordId" }, { status: 400 });
    }

    if (action === "published") {
      await markFeishuTaskPublished(recordId);
      return NextResponse.json({ ok: true });
    }

    const statusText = String(body?.statusText || "").trim();
    if (!statusText) {
      return NextResponse.json({ error: "missing statusText" }, { status: 400 });
    }

    await writeFeishuTaskStatus({
      recordId,
      statusText,
      approvalText: body?.approvalText,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
