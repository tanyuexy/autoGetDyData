import { NextRequest, NextResponse } from "next/server";
import { deleteReviewItem } from "@/lib/reviewService";

export async function DELETE(request: NextRequest) {
  try {
    // 批量删除：JSON body { ids: [...] }
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      const ids: string[] = body?.ids;
      if (Array.isArray(ids) && ids.length > 0) {
        let deleted = 0;
        for (const id of ids) {
          const ok = await deleteReviewItem(id);
          if (ok) deleted++;
        }
        return NextResponse.json({ deleted });
      }
    }

    // 单条删除：?id=xxx
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id or ids required" }, { status: 400 });
    }

    const deleted = await deleteReviewItem(id);
    if (!deleted) {
      return NextResponse.json({ error: "item not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
