import type { UploadFile } from "antd/es/upload/interface";
import {
  readLocalStorageJson,
  removeLocalStorageItem,
  writeLocalStorageJson,
} from "@/lib/browserStorage";
import {
  CONFIG_CACHE_KEY,
  LEGACY_CLIPS_CACHE_KEY,
  REFERENCE_CACHE_KEY,
} from "./constants";
import type { AiVideoCachedConfig, ClipItem, GenerationMode, ReferenceResource } from "./types";

export function readLegacyCachedClips(): ClipItem[] {
  const parsed = readLocalStorageJson<ClipItem[]>(LEGACY_CLIPS_CACHE_KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is ClipItem => Boolean(item && typeof item.id === "string"));
}

export function readCachedReferenceResources(): ReferenceResource[] {
  const parsed = readLocalStorageJson<unknown[]>(REFERENCE_CACHE_KEY, []);
  return Array.isArray(parsed) ? (parsed as ReferenceResource[]) : [];
}

export function readCachedConfig(): AiVideoCachedConfig {
  const parsed = readLocalStorageJson<unknown>(CONFIG_CACHE_KEY, {});
  return parsed && typeof parsed === "object" ? (parsed as AiVideoCachedConfig) : {};
}

export function isGenerationMode(value: unknown): value is GenerationMode {
  return (
    value === "text" ||
    value === "first-frame" ||
    value === "first-last-frame" ||
    value === "multimodal-reference"
  );
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

export function writeStoredConfig(patch: AiVideoCachedConfig) {
  const current = readCachedConfig();
  writeLocalStorageJson(CONFIG_CACHE_KEY, { ...current, ...patch });
}

export function writeReferenceResourcesCache(resources: ReferenceResource[]) {
  writeLocalStorageJson(REFERENCE_CACHE_KEY, resources);
}

export function clearReferenceResourcesCache() {
  removeLocalStorageItem(REFERENCE_CACHE_KEY);
}

export function clearLegacyClipsCache() {
  removeLocalStorageItem(LEGACY_CLIPS_CACHE_KEY);
}
