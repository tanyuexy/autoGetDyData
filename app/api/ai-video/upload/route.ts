import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac"]);
const MAX_IMAGE_SIZE = 12 * 1024 * 1024;
const MAX_VIDEO_SIZE = 200 * 1024 * 1024;
const MAX_AUDIO_SIZE = 80 * 1024 * 1024;

function getExtension(file: File, kind: "image" | "video" | "audio") {
  const byType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
  };
  const fromType = byType[file.type];
  if (fromType) return fromType;
  const ext = path.extname(file.name).toLowerCase();
  if (ext) return ext;
  if (kind === "video") return ".mp4";
  if (kind === "audio") return ".mp3";
  return ".png";
}

function detectKind(file: File): "image" | "video" | "audio" | null {
  if (IMAGE_TYPES.has(file.type)) return "image";
  if (VIDEO_TYPES.has(file.type)) return "video";
  if (AUDIO_TYPES.has(file.type)) return "audio";
  const ext = path.extname(file.name).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return "image";
  if ([".mp4", ".mov", ".webm"].includes(ext)) return "video";
  if ([".mp3", ".wav", ".m4a", ".aac"].includes(ext)) return "audio";
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    }

    const kind = detectKind(file);
    if (!kind) {
      return NextResponse.json(
        { error: "仅支持 JPG、PNG、WebP 图片，MP4、MOV、WebM 视频，或 MP3、WAV、M4A、AAC 音频" },
        { status: 400 }
      );
    }

    const maxSize = kind === "video" ? MAX_VIDEO_SIZE : kind === "audio" ? MAX_AUDIO_SIZE : MAX_IMAGE_SIZE;
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error:
            kind === "video"
              ? "视频不能超过 200MB"
              : kind === "audio"
                ? "音频不能超过 80MB"
                : "图片不能超过 12MB",
        },
        { status: 400 }
      );
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", "ai-video");
    await mkdir(uploadDir, { recursive: true });

    const prefix = kind === "video" ? "clip" : kind === "audio" ? "audio" : "frame";
    const filename = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}${getExtension(file, kind)}`;
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

    return NextResponse.json({
      ok: true,
      kind,
      url: `/uploads/ai-video/${filename}`,
      name: file.name,
      size: file.size,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "上传失败" }, { status: 400 });
  }
}
