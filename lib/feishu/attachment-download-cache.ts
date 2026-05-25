import crypto from "node:crypto";
import path from "node:path";
import fse from "fs-extra";
import { downloadAttachment } from "@/lib/feishu/core/bitable";

export const MATERIALS_DIR = path.resolve(
  process.cwd(),
  process.env.CREATOR_MATERIALS_DIR || "storage/creator-materials"
);

const CACHE_SUBDIR = ".attachment-cache";
const CACHE_DIR = path.join(MATERIALS_DIR, CACHE_SUBDIR);
const INDEX_PATH = path.join(CACHE_DIR, "index.json");
const TEMP_DIR = path.join(CACHE_DIR, ".tmp");

type CacheIndex = {
  byToken: Record<string, { hash: string; fileKey: string }>;
  byHash: Record<string, { fileKey: string }>;
};

type FeishuAttachmentInput = {
  file_token?: string;
  fileToken?: string;
  name?: string;
  type?: string;
  size?: number;
};

function emptyIndex(): CacheIndex {
  return { byToken: {}, byHash: {} };
}

async function loadIndex(): Promise<CacheIndex> {
  try {
    const raw = (await fse.readJson(INDEX_PATH)) as Partial<CacheIndex>;
    return {
      byToken: raw?.byToken && typeof raw.byToken === "object" ? raw.byToken : {},
      byHash: raw?.byHash && typeof raw.byHash === "object" ? raw.byHash : {},
    };
  } catch {
    return emptyIndex();
  }
}

async function saveIndex(index: CacheIndex): Promise<void> {
  await fse.ensureDir(CACHE_DIR);
  await fse.writeJson(INDEX_PATH, index, { spaces: 2 });
}

function sha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function resolveExtension(name: string, mimeType?: string): string {
  const fromName = path.extname(name);
  if (fromName) return fromName.toLowerCase();
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("quicktime")) return ".mov";
  if (mime.includes("webm")) return ".webm";
  return ".bin";
}

function buildFileKey(storedName: string): string {
  return `${CACHE_SUBDIR}/${storedName}`.replace(/\\/g, "/");
}

function resolveCachedPath(fileKey: string): string {
  return path.join(MATERIALS_DIR, fileKey);
}

export async function downloadFeishuAttachmentCached(options: {
  config: unknown;
  accessToken: string;
  attachment: FeishuAttachmentInput;
  log?: (message: string) => void;
}): Promise<{
  fileName: string;
  filePath: string;
  hash: string;
  reused: boolean;
  downloadedFromFeishu: boolean;
}> {
  const fileToken = String(
    options.attachment.file_token || options.attachment.fileToken || ""
  ).trim();
  if (!fileToken) throw new Error("缺少 fileToken");

  const index = await loadIndex();
  const cachedByToken = index.byToken[fileToken];
  if (cachedByToken?.fileKey) {
    const cachedPath = resolveCachedPath(cachedByToken.fileKey);
    if (await fse.pathExists(cachedPath)) {
      options.log?.(`素材缓存命中(token): ${cachedByToken.fileKey}`);
      return {
        fileName: cachedByToken.fileKey,
        filePath: cachedPath,
        hash: cachedByToken.hash,
        reused: true,
        downloadedFromFeishu: false,
      };
    }
  }

  const originalName = String(options.attachment.name || fileToken).trim() || fileToken;
  options.log?.(`下载附件: ${originalName}`);
  await fse.ensureDir(TEMP_DIR);
  const tempName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${originalName}`;
  const downloaded = await downloadAttachment(
    options.config,
    options.accessToken,
    fileToken,
    TEMP_DIR,
    tempName
  );

  try {
    const buffer = await fse.readFile(downloaded.filePath);
    const hash = sha256Hex(buffer);
    const ext = resolveExtension(originalName, options.attachment.type);
    const storedName = `${hash}${ext}`;
    const defaultFileKey = buildFileKey(storedName);

    const existingByHash = index.byHash[hash];
    if (existingByHash?.fileKey) {
      const existingPath = resolveCachedPath(existingByHash.fileKey);
      if (await fse.pathExists(existingPath)) {
        index.byToken[fileToken] = { hash, fileKey: existingByHash.fileKey };
        await saveIndex(index);
        options.log?.(`素材缓存命中(hash): ${existingByHash.fileKey}`);
        return {
          fileName: existingByHash.fileKey,
          filePath: existingPath,
          hash,
          reused: true,
          downloadedFromFeishu: true,
        };
      }
    }

    const targetPath = resolveCachedPath(defaultFileKey);
    await fse.ensureDir(path.dirname(targetPath));
    if (!(await fse.pathExists(targetPath))) {
      await fse.move(downloaded.filePath, targetPath, { overwrite: true });
    } else {
      await fse.remove(downloaded.filePath).catch(() => undefined);
    }

    index.byHash[hash] = { fileKey: defaultFileKey };
    index.byToken[fileToken] = { hash, fileKey: defaultFileKey };
    await saveIndex(index);
    options.log?.(`素材已写入缓存: ${defaultFileKey}`);

    return {
      fileName: defaultFileKey,
      filePath: targetPath,
      hash,
      reused: false,
      downloadedFromFeishu: true,
    };
  } finally {
    if (await fse.pathExists(downloaded.filePath)) {
      await fse.remove(downloaded.filePath).catch(() => undefined);
    }
  }
}

export function localMaterialFileKeysExist(fileKeys: string[]): boolean {
  if (!Array.isArray(fileKeys) || fileKeys.length === 0) return false;
  return fileKeys.every((key) => {
    const normalized = String(key || "").trim();
    if (!normalized) return false;
    return fse.existsSync(resolveCachedPath(normalized));
  });
}
