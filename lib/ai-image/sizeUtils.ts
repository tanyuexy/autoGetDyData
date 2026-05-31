import { RESOLUTION_LONG_EDGE } from "./constants";
import type { AiImageAspectRatio, AiImageResolutionTier, AiImageSize } from "./types";

const MIN_TOTAL_PIXELS = 655_360;
const MAX_TOTAL_PIXELS = 8_294_400;
const MAX_EDGE = 3840;
const MAX_ASPECT = 3;

function roundTo16(value: number) {
  return Math.max(16, Math.round(value / 16) * 16);
}

function parseAspectRatio(value: AiImageAspectRatio) {
  if (value === "auto") return null;
  const [w, h] = value.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

export function isValidImageDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  if (width % 16 !== 0 || height % 16 !== 0) return false;
  if (Math.max(width, height) > MAX_EDGE) return false;

  const aspect = Math.max(width, height) / Math.min(width, height);
  if (aspect > MAX_ASPECT + 0.001) return false;

  const total = width * height;
  if (total < MIN_TOTAL_PIXELS || total > MAX_TOTAL_PIXELS) return false;
  return true;
}

export function resolveImageDimensions(
  aspectRatio: AiImageAspectRatio,
  resolution: AiImageResolutionTier
): AiImageSize {
  if (aspectRatio === "auto") return "auto";

  const ratio = parseAspectRatio(aspectRatio);
  const longEdge = RESOLUTION_LONG_EDGE[resolution] || 1024;
  if (!ratio) return `${longEdge}x${longEdge}`;

  let width: number;
  let height: number;

  if (ratio.w >= ratio.h) {
    width = longEdge;
    height = Math.round((longEdge * ratio.h) / ratio.w);
  } else {
    height = longEdge;
    width = Math.round((longEdge * ratio.w) / ratio.h);
  }

  width = roundTo16(width);
  height = roundTo16(height);

  if (!isValidImageDimensions(width, height)) {
    return "1024x1024";
  }

  return `${width}x${height}`;
}

export function formatImageSizeLabel(size: AiImageSize) {
  if (size === "auto") return "自动尺寸";
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return size;
  return `${match[1]} × ${match[2]}`;
}

export function getSizeAspectRatio(size: AiImageSize) {
  if (size === "auto") return 1;
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return 1;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return 1;
  return width / height;
}

export function migrateLegacySize(size: unknown): {
  aspectRatio: AiImageAspectRatio;
  resolution: AiImageResolutionTier;
} {
  const normalized = String(size || "").trim();
  switch (normalized) {
    case "1024x1536":
      return { aspectRatio: "2:3", resolution: "2k" };
    case "1536x1024":
      return { aspectRatio: "3:2", resolution: "2k" };
    case "auto":
      return { aspectRatio: "auto", resolution: "1k" };
    case "1024x1024":
    default:
      return { aspectRatio: "1:1", resolution: "1k" };
  }
}

export function normalizeAspectRatio(value: unknown): AiImageAspectRatio {
  const aspectRatio = String(value || "").trim() as AiImageAspectRatio;
  const allowed = new Set([
    "auto",
    "1:1",
    "3:2",
    "2:3",
    "16:9",
    "9:16",
    "4:3",
    "3:4",
  ]);
  return allowed.has(aspectRatio) ? aspectRatio : "1:1";
}

export function normalizeResolutionTier(value: unknown): AiImageResolutionTier {
  const raw = String(value || "").trim().toLowerCase();
  const legacyMap: Record<string, AiImageResolutionTier> = {
    "1024": "1k",
    "1536": "2k",
    "2048": "2k",
    "3840": "4k",
    "1k": "1k",
    "2k": "2k",
    "4k": "4k",
  };
  return legacyMap[raw] ?? "1k";
}

export function normalizeImageSize(value: unknown): AiImageSize {
  const size = String(value || "").trim();
  if (size === "auto") return "auto";
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return "1024x1024";
  const width = Number(match[1]);
  const height = Number(match[2]);
  return isValidImageDimensions(width, height) ? (`${width}x${height}` as AiImageSize) : "1024x1024";
}
