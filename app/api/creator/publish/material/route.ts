import path from "path";
import { NextRequest, NextResponse } from "next/server";
import fse from "fs-extra";

const MATERIALS_DIR = path.resolve(
  process.env.CREATOR_MATERIALS_DIR ||
    path.join(process.cwd(), "storage/creator-materials")
);

const ALLOWED_EXT = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

function contentTypeByExt(ext: string): string {
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".m4v":
      return "video/x-m4v";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function isSafeFileKey(key: string): boolean {
  if (!key || key.includes("/") || key.includes("\\") || key.includes("..")) {
    return false;
  }
  const ext = path.extname(key).toLowerCase();
  return ALLOWED_EXT.has(ext);
}

export async function GET(req: NextRequest) {
  try {
    const key = String(req.nextUrl.searchParams.get("key") || "").trim();
    if (!isSafeFileKey(key)) {
      return NextResponse.json({ error: "invalid key" }, { status: 400 });
    }

    const fullPath = path.resolve(MATERIALS_DIR, key);
    if (!fullPath.startsWith(`${MATERIALS_DIR}${path.sep}`)) {
      return NextResponse.json({ error: "path not allowed" }, { status: 403 });
    }
    if (!fse.existsSync(fullPath)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const ext = path.extname(key).toLowerCase();
    const file = fse.readFileSync(fullPath);
    return new NextResponse(file, {
      headers: {
        "Content-Type": contentTypeByExt(ext),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
