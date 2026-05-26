import { copyFile, mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { getTosConfig } from "@/lib/tos/config";
import { buildTosObjectKey, uploadBufferToTos } from "@/lib/tos/uploadMedia";

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

function inferVideoContentType(sourceUrl: string) {
  const ext = inferVideoExtension(sourceUrl);
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  return "video/mp4";
}

export function isArchivedVideoUrl(url: string) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return false;
  if (trimmed.startsWith(GENERATED_VIDEOS_URL_PREFIX) || trimmed.startsWith(COMPOSED_FILMS_URL_PREFIX)) {
    return true;
  }
  const config = getTosConfig();
  return Boolean(config && trimmed.startsWith(`${config.publicBaseUrl}/`));
}

export function isLocalGeneratedVideoUrl(url: string) {
  return isArchivedVideoUrl(url);
}

async function readVideoBuffer(sourceUrl: string) {
  const trimmed = String(sourceUrl || "").trim();
  if (!trimmed) throw new Error("缺少视频 URL");

  if (trimmed.startsWith("/")) {
    const localPath = path.join(process.cwd(), "public", trimmed);
    if (existsSync(localPath)) {
      return readFile(localPath);
    }
    const res = await fetch(`${getOrigin()}${trimmed}`);
    if (!res.ok) throw new Error(`下载视频失败：HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  const res = await fetch(trimmed);
  if (!res.ok) throw new Error(`下载视频失败：HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function persistVideoBuffer(input: {
  buffer: Buffer;
  filename: string;
  sourceUrl: string;
  localDir: string;
  localUrlPrefix: string;
}) {
  const tosConfig = getTosConfig();
  if (tosConfig) {
    const objectKey = buildTosObjectKey(tosConfig.outputPrefix, input.filename);
    const uploaded = await uploadBufferToTos({
      body: input.buffer,
      objectKey,
      contentType: inferVideoContentType(input.sourceUrl),
    });
    return uploaded.url;
  }

  await mkdir(input.localDir, { recursive: true });
  const outputPath = path.join(input.localDir, input.filename);
  await writeFile(outputPath, input.buffer);
  return `${input.localUrlPrefix}${input.filename}`;
}

export async function archiveClipVideo(sourceUrl: string, clipId: string): Promise<string> {
  const trimmed = String(sourceUrl || "").trim();
  if (!trimmed) throw new Error("缺少视频 URL");
  if (isArchivedVideoUrl(trimmed)) return trimmed;

  const ext = inferVideoExtension(trimmed);
  const safeClipId = clipId.replace(/[^\w-]+/g, "-") || "clip";
  const filename = `clip-${safeClipId}-${Date.now()}${ext}`;
  const buffer = await readVideoBuffer(trimmed);

  return persistVideoBuffer({
    buffer,
    filename,
    sourceUrl: trimmed,
    localDir: GENERATED_VIDEOS_DIR,
    localUrlPrefix: GENERATED_VIDEOS_URL_PREFIX,
  });
}

export async function archiveComposedFilmFile(sourcePath: string, filename: string): Promise<string> {
  const buffer = await readFile(sourcePath);
  return persistVideoBuffer({
    buffer,
    filename,
    sourceUrl: filename,
    localDir: COMPOSED_FILMS_DIR,
    localUrlPrefix: COMPOSED_FILMS_URL_PREFIX,
  });
}
