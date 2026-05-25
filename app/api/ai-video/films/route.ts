import { NextRequest, NextResponse } from "next/server";
import { deleteAiVideoComposedFilm, readAiVideoComposedFilms } from "@/lib/aiVideoComposedFilmService";

export const runtime = "nodejs";

export async function GET() {
  try {
    const items = await readAiVideoComposedFilms();
    return NextResponse.json({ items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "读取成片列表失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
    const ok = await deleteAiVideoComposedFilm(id);
    if (!ok) return NextResponse.json({ error: "成片不存在" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "删除成片失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
