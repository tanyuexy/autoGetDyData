import { NextResponse } from "next/server";
import { peekFeishuPublishImportCandidates } from "@/lib/feishu/service";

export async function POST() {
  try {
    const result = await peekFeishuPublishImportCandidates();
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
