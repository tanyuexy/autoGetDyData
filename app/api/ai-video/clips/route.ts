import { NextRequest, NextResponse } from "next/server";
import type { AiVideoClip } from "@/types";
import { requireAppSession, resolveOwnerUsername } from "@/lib/auth/requireSession";
import { deleteAiVideoClip, readAiVideoClips, upsertAiVideoClip, upsertAiVideoClips } from "@/lib/ai-video/clipService";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await requireAppSession(request);
  if (session instanceof NextResponse) return session;
  try {
    const items = await readAiVideoClips();
    return NextResponse.json({ items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "读取片段列表失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAppSession(request);
  if (session instanceof NextResponse) return session;
  const owner = resolveOwnerUsername(session);
  try {
    const body = await request.json();
    if (Array.isArray(body.clips)) {
      const items = await upsertAiVideoClips(body.clips as AiVideoClip[], owner);
      return NextResponse.json({ items });
    }
    const clip = await upsertAiVideoClip((body.clip ?? body) as AiVideoClip, owner);
    return NextResponse.json({ clip });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "保存片段失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireAppSession(request);
  if (session instanceof NextResponse) return session;
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少 id" }, { status: 400 });
    }
    const ok = await deleteAiVideoClip(id, resolveOwnerUsername(session));
    if (!ok) {
      return NextResponse.json({ error: "片段不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "删除片段失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
