import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getTosConfig } from "@/lib/tos/config";
import { buildTosObjectKey, uploadBufferToTos } from "@/lib/tos/uploadMedia";
import { requireAppSession } from "@/lib/auth/requireSession";
import {
  buildUploadFilename,
  detectUploadKind,
  getUploadContentType,
  getUploadMaxSize,
  getUploadSizeError,
} from "@/lib/ai-video/uploadValidation";

export const runtime = "nodejs";

/** 参考图落盘本地；若已配置 TOS 则同步上传，生成时用真实可访问的公网 URL */
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

    const contentType = getUploadContentType(file, kind);
    let url = `/uploads/ai-image/${filename}`;
    let storage: "local" | "tos" = "local";

    const tosConfig = getTosConfig();
    if (tosConfig) {
      const objectKey = buildTosObjectKey(tosConfig.uploadPrefix, `ai-image/${filename}`);
      const uploaded = await uploadBufferToTos({
        body,
        objectKey,
        contentType,
      });
      url = uploaded.url;
      storage = "tos";
    }

    return NextResponse.json({
      ok: true,
      kind,
      storage,
      url,
      localPath: `/uploads/ai-image/${filename}`,
      name: file.name,
      size: file.size,
      contentType,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "上传失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
