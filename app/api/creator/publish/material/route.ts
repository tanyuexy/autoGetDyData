import path from "path";
import { NextRequest, NextResponse } from "next/server";
import fse from "fs-extra";
import {
  contentTypeByMaterialExt,
  resolveCreatorMaterialPath,
} from "@/lib/creator-materials/path";

export async function GET(req: NextRequest) {
  try {
    const key = String(req.nextUrl.searchParams.get("key") || "").trim();
    const fullPath = resolveCreatorMaterialPath(key);
    if (!fullPath) {
      return NextResponse.json({ error: "invalid key" }, { status: 400 });
    }
    if (!fse.existsSync(fullPath)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const ext = path.extname(fullPath).toLowerCase();
    const file = fse.readFileSync(fullPath);
    return new NextResponse(file, {
      headers: {
        "Content-Type": contentTypeByMaterialExt(ext),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
