import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const MATERIALS_DIR = path.resolve(
  process.env.CREATOR_MATERIALS_DIR ||
    path.join(process.cwd(), "storage/creator-materials")
);

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function safeName(name: string) {
  return String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 120);
}

export const maxDuration = 0;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }

    ensureDir(MATERIALS_DIR);

    const originalName = safeName(file.name || "upload.bin");
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const rand = crypto.randomBytes(4).toString("hex");
    const fileKey = `${ts}-${rand}-${base}${ext}`;
    const absPath = path.join(MATERIALS_DIR, fileKey);

    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(absPath, buf);

    return NextResponse.json({ ok: true, fileKey, originalName, size: buf.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
