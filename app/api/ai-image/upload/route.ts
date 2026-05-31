import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { requireAppSession } from "@/lib/auth/requireSession";
import {
  buildUploadFilename,
  detectUploadKind,
  getUploadContentType,
  getUploadMaxSize,
  getUploadSizeError,
} from "@/lib/ai-video/uploadValidation";

export const runtime = "nodejs";

/** 参考图仅落盘到 public/uploads/ai-image，生成时由服务端转 data URL，无需走 TOS */
export async function POST(request: NextRequest) {
  const session = await requireAppSession(request);
  if (session instanceof NextResponse) return session;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择图片文件" }, { status: 400 });
    }

    const kind = detectUploadKind(file);
    if (kind !== "image") {
      return NextResponse.json(
        { error: "参考图仅支持 JPG、PNG、WebP 图片" },
        { status: 400 }
      );
    }

    const maxSize = getUploadMaxSize(kind);
    if (file.size > maxSize) {
      return NextResponse.json({ error: getUploadSizeError(kind) }, { status: 400 });
    }

    const filename = buildUploadFilename(kind, file).replace(/^frame-/, "ref-");
    const body = Buffer.from(await file.arrayBuffer());
    const uploadDir = path.join(process.cwd(), "public", "uploads", "ai-image");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, filename), body);

    return NextResponse.json({
      ok: true,
      kind,
      storage: "local",
      url: `/uploads/ai-image/${filename}`,
      name: file.name,
      size: file.size,
      contentType: getUploadContentType(file, kind),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "上传失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
