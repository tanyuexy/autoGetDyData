import { readFile } from "fs/promises";
import path from "path";

const LOCAL_PREFIX = "/uploads/ai-image/";

export type LocalReferenceFile = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

function mimeFromExtension(ext: string) {
  const normalized = ext.toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "webp") return "image/webp";
  return "image/png";
}

export function isLocalAiImageUploadUrl(url: string) {
  const cleaned = String(url || "").trim();
  if (cleaned.startsWith(LOCAL_PREFIX)) return true;
  try {
    return new URL(cleaned).pathname.startsWith(LOCAL_PREFIX);
  } catch {
    return false;
  }
}

function resolveLocalPath(url: string) {
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.startsWith("/") ? url : `/${url}`;
  }
  if (!pathname.startsWith(LOCAL_PREFIX)) return null;
  const filename = pathname.slice(LOCAL_PREFIX.length);
  if (!filename || filename.includes("/") || filename.includes("..")) return null;
  return path.join(process.cwd(), "public", "uploads", "ai-image", filename);
}

export async function loadLocalReferenceFiles(urls: string[]): Promise<LocalReferenceFile[]> {
  const files: LocalReferenceFile[] = [];
  for (const raw of urls) {
    const filePath = resolveLocalPath(raw);
    if (!filePath) continue;
    const buffer = await readFile(filePath);
    const ext = path.extname(filePath).slice(1) || "png";
    files.push({
      buffer,
      contentType: mimeFromExtension(ext),
      filename: path.basename(filePath),
    });
  }
  return files;
}
