import { readFile } from "fs/promises";
import path from "path";

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
    const buffer = await readFile(filePath);
    const mime = mimeFromExtension(path.extname(filename).slice(1));
    return `data:image/${mime};base64,${buffer.toString("base64")}`;
  }

  return null;
}

function toPublicAbsoluteUrl(url: string) {
  const publicBase = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!publicBase) return null;
  if (url.startsWith("/")) return `${publicBase}${url}`;
  return url;
}

export async function resolveReferenceUrlsForApi(urls: string[]) {
  const resolved: string[] = [];

  for (const raw of urls) {
    const cleaned = cleanUrl(raw);
    if (!cleaned) continue;

    if (cleaned.startsWith("data:image/")) {
      resolved.push(cleaned);
      continue;
    }

    if (cleaned.startsWith("/") || isProbablyLocalUrl(cleaned)) {
      const dataUrl = await readLocalUploadAsDataUrl(cleaned);
      if (dataUrl) {
        resolved.push(dataUrl);
        continue;
      }
      const absolute = toPublicAbsoluteUrl(cleaned.startsWith("/") ? cleaned : cleaned);
      if (absolute && !isProbablyLocalUrl(absolute)) {
        resolved.push(absolute);
        continue;
      }
      throw new Error(
        "参考图 URL 无法被中转站访问。请通过页面上传，或配置 PUBLIC_BASE_URL 为公网可访问地址。"
      );
    }

    resolved.push(cleaned);
  }

  return resolved;
}
