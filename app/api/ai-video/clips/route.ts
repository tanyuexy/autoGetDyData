import { NextRequest, NextResponse } from "next/server";
import type { AiVideoClip } from "@/types";
import { deleteAiVideoClip, readAiVideoClips, upsertAiVideoClip, upsertAiVideoClips } from "@/lib/aiVideoClipService";

export const runtime = "nodejs";

export async function GET() {
  try {
    const items = await readAiVideoClips();
    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "读取片段列表失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (Array.isArray(body.clips)) {
      const items = await upsertAiVideoClips(body.clips as AiVideoClip[]);
      return NextResponse.json({ items });
    }
    const clip = await upsertAiVideoClip((body.clip ?? body) as AiVideoClip);
    return NextResponse.json({ clip });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "保存片段失败" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少 id" }, { status: 400 });
    }
    const ok = await deleteAiVideoClip(id);
    if (!ok) {
      return NextResponse.json({ error: "片段不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "删除片段失败" }, { status: 500 });
  }
}
