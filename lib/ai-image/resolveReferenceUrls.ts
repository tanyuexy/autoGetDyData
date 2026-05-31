import { readFile, stat } from "fs/promises";
import path from "path";
import { REFERENCE_IMAGE_API_MAX_BYTES } from "./constants";

const UPLOAD_PREFIXES = [
  { urlPrefix: "/uploads/ai-image/", dir: "ai-image" },
  { urlPrefix: "/uploads/ai-video/", dir: "ai-video" },
] as const;

function cleanUrl(url: string) {
  return String(url || "").trim();
}

function mimeFromExtension(ext: string) {
  const normalized = ext.toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") return "jpeg";
  if (normalized === "webp") return "webp";
  if (normalized === "gif") return "gif";
  return "png";
}

function isNonPublicHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function isProbablyLocalUrl(url: string) {
  if (url.startsWith("/")) return true;
  try {
    return isNonPublicHost(new URL(url).hostname);
  } catch {
    return true;
  }
}

async function readLocalUploadAsDataUrl(url: string) {
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.startsWith("/") ? url : `/${url}`;
  }

  for (const { urlPrefix, dir } of UPLOAD_PREFIXES) {
    if (!pathname.startsWith(urlPrefix)) continue;
    const filename = pathname.slice(urlPrefix.length);
    if (!filename || filename.includes("/") || filename.includes("..")) return null;
    const filePath = path.join(process.cwd(), "public", "uploads", dir, filename);
    const fileStat = await stat(filePath);
    if (fileStat.size > REFERENCE_IMAGE_API_MAX_BYTES) {
      throw new Error(
        `参考图 ${filename} 过大（${formatMb(fileStat.size)}），请压缩到 ${formatMb(REFERENCE_IMAGE_API_MAX_BYTES)} 以内后重试`
      );
    }
    const buffer = await readFile(filePath);
    const mime = mimeFromExtension(path.extname(filename).slice(1));
    return `data:image/${mime};base64,${buffer.toString("base64")}`;
  }

  return null;
}

async function resolveOneReferenceUrl(raw: string) {
  const cleaned = cleanUrl(raw);
  if (!cleaned) return null;

  if (cleaned.startsWith("blob:")) {
    throw new Error("参考图仍在上传中，请等待上传完成后再生成");
  }

  if (cleaned.startsWith("data:image/")) {
    return cleaned;
  }

  if (cleaned.startsWith("/") || isProbablyLocalUrl(cleaned)) {
    let pathname = cleaned;
    try {
      pathname = new URL(cleaned).pathname;
    } catch {
      pathname = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
    }

    if (pathname.startsWith("/uploads/ai-image/")) {
      const dataUrl = await readLocalUploadAsDataUrl(cleaned);
      if (dataUrl) return dataUrl;
      throw new Error("参考图文件不存在，请重新上传");
    }

    const dataUrl = await readLocalUploadAsDataUrl(cleaned);
    if (dataUrl) return dataUrl;

    const absolute = toPublicAbsoluteUrl(cleaned.startsWith("/") ? cleaned : cleaned);
    if (absolute && !isProbablyLocalUrl(absolute)) {
      return absolute;
    }

    throw new Error(
      "参考图 URL 无法被中转站访问。请通过页面上传，或配置可访问本应用 /uploads 的 PUBLIC_BASE_URL。"
    );
  }

  return cleaned;
}

function getPublicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || process.env.TOS_PUBLIC_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
}

function toPublicAbsoluteUrl(url: string) {
  const publicBase = getPublicBaseUrl();
  if (!publicBase) return null;
  if (url.startsWith("/")) return `${publicBase}${url}`;
  return url;
}

function formatMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function resolveReferenceUrlsForApi(urls: string[]) {
  const resolved = await Promise.all(
    urls.map((raw) => resolveOneReferenceUrl(raw))
  );
  return resolved.filter((item): item is string => Boolean(item));
}
