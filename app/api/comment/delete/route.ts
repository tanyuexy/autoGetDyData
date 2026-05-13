import { NextRequest, NextResponse } from "next/server";
import { deleteCommentItem } from "@/lib/commentService";

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    const body = await request.json().catch(() => null);
    const ids = body?.ids as string[] | undefined;

    if (Array.isArray(ids)) {
      let count = 0;
      for (const itemId of ids) {
        if (await deleteCommentItem(itemId)) count++;
      }
      return NextResponse.json({ deleted: count });
    }

    if (id) {
      const ok = await deleteCommentItem(id);
      if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ deleted: 1 });
    }

    return NextResponse.json({ error: "id or ids required" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
