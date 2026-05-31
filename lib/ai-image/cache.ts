import {
  readLocalStorageJson,
  writeLocalStorageJson,
} from "@/lib/browserStorage";
import type { AiGeneratedImage, AiImageCachedSettings } from "./types";

const HISTORY_CACHE_KEY = "ai-image:gpt-image2-history";
const SETTINGS_CACHE_KEY = "ai-image:gpt-image2-settings";
const MAX_HISTORY_ITEMS = 80;

export function readAiImageHistory(): AiGeneratedImage[] {
  const parsed = readLocalStorageJson<unknown[]>(HISTORY_CACHE_KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is AiGeneratedImage =>
      Boolean(
        item &&
          typeof item === "object" &&
          typeof (item as AiGeneratedImage).id === "string" &&
          typeof (item as AiGeneratedImage).url === "string"
      )
  );
}

export function writeAiImageHistory(items: AiGeneratedImage[]): boolean {
  return writeLocalStorageJson(HISTORY_CACHE_KEY, items.slice(0, MAX_HISTORY_ITEMS));
}

/** 将新生成的图片合并进历史并立即落盘（不依赖 React setState，避免切页卸载后丢失） */
export function prependAiImageHistory(newImages: AiGeneratedImage[]): AiGeneratedImage[] {
  const next = [...newImages, ...readAiImageHistory()].slice(0, MAX_HISTORY_ITEMS);
  writeAiImageHistory(next);
  return next;
}

export function mutateAiImageHistory(
  updater: (prev: AiGeneratedImage[]) => AiGeneratedImage[]
): AiGeneratedImage[] {
  const next = updater(readAiImageHistory()).slice(0, MAX_HISTORY_ITEMS);
  writeAiImageHistory(next);
  return next;
}

export function readAiImageSettings(): AiImageCachedSettings {
  const parsed = readLocalStorageJson<unknown>(SETTINGS_CACHE_KEY, {});
  return parsed && typeof parsed === "object" ? (parsed as AiImageCachedSettings) : {};
}

export function writeAiImageSettings(settings: AiImageCachedSettings) {
  writeLocalStorageJson(SETTINGS_CACHE_KEY, settings);
}
