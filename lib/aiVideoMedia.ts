import { copyFile, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const GENERATED_VIDEOS_DIR = path.join(process.cwd(), "public", "generated-videos");
export const GENERATED_VIDEOS_URL_PREFIX = "/generated-videos/";

const COMPOSED_FILMS_DIR = path.join(process.cwd(), "public", "composed-films");
export const COMPOSED_FILMS_URL_PREFIX = "/composed-films/";

export function getComposedFilmsDir() {
  return COMPOSED_FILMS_DIR;
}

function getOrigin() {
  return (process.env.PUBLIC_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
}

function inferVideoExtension(sourceUrl: string) {
  try {
    const ext = path.extname(new URL(sourceUrl, getOrigin()).pathname).toLowerCase();
    if ([".mp4", ".mov", ".webm"].includes(ext)) return ext;
  } catch {}
  return ".mp4";
}

export function isLocalGeneratedVideoUrl(url: string) {
  const trimmed = String(url || "").trim();
  return trimmed.startsWith(GENERATED_VIDEOS_URL_PREFIX);
}

async function writeRemoteVideo(sourceUrl: string, outputPath: string) {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`下载视频失败：HTTP ${res.status}`);
  await writeFile(outputPath, Buffer.from(await res.arrayBuffer()));
}

async function writeLocalPublicVideo(relativeUrl: string, outputPath: string) {
  const localPath = path.join(process.cwd(), "public", relativeUrl);
  if (existsSync(localPath)) {
    await copyFile(localPath, outputPath);
    return;
  }
  await writeRemoteVideo(`${getOrigin()}${relativeUrl}`, outputPath);
}

export async function archiveClipVideo(sourceUrl: string, clipId: string): Promise<string> {
  const trimmed = String(sourceUrl || "").trim();
  if (!trimmed) throw new Error("缺少视频 URL");
  if (isLocalGeneratedVideoUrl(trimmed)) return trimmed;

  await mkdir(GENERATED_VIDEOS_DIR, { recursive: true });
  const ext = inferVideoExtension(trimmed);
  const safeClipId = clipId.replace(/[^\w-]+/g, "-") || "clip";
  const filename = `clip-${safeClipId}-${Date.now()}${ext}`;
  const outputPath = path.join(GENERATED_VIDEOS_DIR, filename);
  const publicUrl = `${GENERATED_VIDEOS_URL_PREFIX}${filename}`;

  if (trimmed.startsWith("/")) {
    await writeLocalPublicVideo(trimmed, outputPath);
    return publicUrl;
  }

  await writeRemoteVideo(trimmed, outputPath);
  return publicUrl;
}
