import type { UploadFile } from "antd/es/upload/interface";
import {
  CONFIG_CACHE_KEY,
  LEGACY_CLIPS_CACHE_KEY,
  REFERENCE_CACHE_KEY,
} from "./constants";
import type { AiVideoCachedConfig, ClipItem, GenerationMode, ReferenceResource } from "./types";

export function readLegacyCachedClips(): ClipItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEGACY_CLIPS_CACHE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === "string");
  } catch {
    return [];
  }
}

export function readCachedReferenceResources(): ReferenceResource[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REFERENCE_CACHE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readCachedConfig(): AiVideoCachedConfig {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONFIG_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function isGenerationMode(value: unknown): value is GenerationMode {
  return value === "text" || value === "first-frame" || value === "first-last-frame";
}

export function readCachedUploadFiles(value: unknown): UploadFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && typeof item.uid === "string")
    .slice(0, 1)
    .map((item: UploadFile) => ({
      uid: item.uid,
      name: String(item.name || "已上传文件"),
      status: item.status === "done" ? "done" : undefined,
      url: typeof item.url === "string" ? item.url : undefined,
      thumbUrl: typeof item.thumbUrl === "string" ? item.thumbUrl : undefined,
    }));
}

export function serializeUploadFiles(files: UploadFile[]): UploadFile[] {
  return files.map((file) => ({
    uid: file.uid,
    name: file.name,
    status: file.status,
    url: file.url,
    thumbUrl: file.thumbUrl,
  }));
}

function readStoredConfig(): AiVideoCachedConfig {
  try {
    return JSON.parse(window.localStorage.getItem(CONFIG_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function writeStoredConfig(patch: AiVideoCachedConfig) {
  try {
    const current = readStoredConfig();
    window.localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {}
}

export function writeReferenceResourcesCache(resources: ReferenceResource[]) {
  try {
    window.localStorage.setItem(REFERENCE_CACHE_KEY, JSON.stringify(resources));
  } catch {}
}

export function clearReferenceResourcesCache() {
  try {
    window.localStorage.removeItem(REFERENCE_CACHE_KEY);
  } catch {}
}

export function clearLegacyClipsCache() {
  try {
    window.localStorage.removeItem(LEGACY_CLIPS_CACHE_KEY);
  } catch {}
}
