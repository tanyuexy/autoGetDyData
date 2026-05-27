import path from "node:path";

export const CREATOR_MATERIALS_DIR = path.resolve(
  process.cwd(),
  process.env.CREATOR_MATERIALS_DIR || "storage/creator-materials"
);

const ATTACHMENT_CACHE_PREFIX = ".attachment-cache/";

export const ALLOWED_MATERIAL_EXT = new Set([
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

function normalizeFileKey(key: string): string {
  return String(key || "").trim().replace(/\\/g, "/");
}

function hasAllowedExtension(name: string): boolean {
  return ALLOWED_MATERIAL_EXT.has(path.extname(name).toLowerCase());
}

/** 允许根目录文件名，或 `.attachment-cache/<hash>.<ext>` 缓存路径。 */
export function isAllowedMaterialFileKey(key: string): boolean {
  const normalized = normalizeFileKey(key);
  if (!normalized || normalized.includes("..")) return false;

  if (!normalized.includes("/")) {
    return hasAllowedExtension(normalized);
  }

  if (!normalized.startsWith(ATTACHMENT_CACHE_PREFIX)) return false;
  const cachedName = normalized.slice(ATTACHMENT_CACHE_PREFIX.length);
  if (!cachedName || cachedName.includes("/")) return false;
  return hasAllowedExtension(cachedName);
}

export function resolveCreatorMaterialPath(fileKey: string): string | null {
  if (!isAllowedMaterialFileKey(fileKey)) return null;

  const normalized = normalizeFileKey(fileKey);
  const fullPath = path.resolve(CREATOR_MATERIALS_DIR, normalized);
  const materialsRoot = `${CREATOR_MATERIALS_DIR}${path.sep}`;
  if (!fullPath.startsWith(materialsRoot)) return null;
  return fullPath;
}

export function contentTypeByMaterialExt(ext: string): string {
  switch (ext.toLowerCase()) {
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
