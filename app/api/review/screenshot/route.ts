import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const SCREENSHOT_ROOT = path.resolve(process.cwd(), "storage/creator-accounts");

export async function GET(request: NextRequest) {
  try {
    const rawPath = request.nextUrl.searchParams.get("path") || "";
    if (!rawPath) {
      return NextResponse.json({ error: "path required" }, { status: 400 });
    }

    const fullPath = path.resolve(process.cwd(), rawPath);
    if (!fullPath.startsWith(`${SCREENSHOT_ROOT}${path.sep}`)) {
      return NextResponse.json({ error: "path not allowed" }, { status: 403 });
    }
    if (path.extname(fullPath).toLowerCase() !== ".png") {
      return NextResponse.json({ error: "only png screenshots are allowed" }, { status: 400 });
    }
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ error: "screenshot not found" }, { status: 404 });
    }

    const file = fs.readFileSync(fullPath);
    return new NextResponse(file, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
