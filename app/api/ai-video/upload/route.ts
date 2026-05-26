import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  buildUploadFilename,
  detectUploadKind,
  getUploadContentType,
  getUploadMaxSize,
  getUploadSizeError,
} from "@/lib/ai-video/uploadValidation";
import { getTosConfig } from "@/lib/tos/config";
import { buildTosObjectKey, uploadBufferToTos } from "@/lib/tos/uploadMedia";

export const runtime = "nodejs";

export async function GET() {
  const config = getTosConfig();
  return NextResponse.json({
    tosEnabled: Boolean(config),
    bucket: config?.bucket || null,
    uploadPrefix: config?.uploadPrefix || null,
    publicBaseUrl: config?.publicBaseUrl || null,
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    }

    const kind = detectUploadKind(file);
    if (!kind) {
      return NextResponse.json(
        { error: "仅支持 JPG、PNG、WebP 图片，MP4、MOV、WebM 视频，或 MP3、WAV、M4A、AAC 音频" },
        { status: 400 }
      );
    }

    const maxSize = getUploadMaxSize(kind);
    if (file.size > maxSize) {
      return NextResponse.json({ error: getUploadSizeError(kind) }, { status: 400 });
    }

    const filename = buildUploadFilename(kind, file);
    const body = Buffer.from(await file.arrayBuffer());
    const contentType = getUploadContentType(file, kind);
    const tosConfig = getTosConfig();

    if (tosConfig) {
      const objectKey = buildTosObjectKey(tosConfig.uploadPrefix, filename);
      const uploaded = await uploadBufferToTos({
        body,
        objectKey,
        contentType,
      });

      return NextResponse.json({
        ok: true,
        kind,
        storage: "tos",
        url: uploaded.url,
        objectKey: uploaded.objectKey,
        bucket: uploaded.bucket,
        name: file.name,
        size: file.size,
      });
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", "ai-video");
    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, body);

    return NextResponse.json({
      ok: true,
      kind,
      storage: "local",
      url: `/uploads/ai-video/${filename}`,
      name: file.name,
      size: file.size,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "上传失败" }, { status: 400 });
  }
}
