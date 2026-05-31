import type { AiImageAspectRatio, AiImageQuality, AiImageResolutionTier } from "./types";

export const ASPECT_RATIO_OPTIONS: Array<{ label: string; value: AiImageAspectRatio; hint?: string }> = [
  { label: "自动", value: "auto", hint: "模型自选" },
  { label: "1:1", value: "1:1", hint: "方图" },
  { label: "3:2", value: "3:2", hint: "横图" },
  { label: "2:3", value: "2:3", hint: "竖图" },
  { label: "16:9", value: "16:9", hint: "宽屏" },
  { label: "9:16", value: "9:16", hint: "竖屏" },
  { label: "4:3", value: "4:3", hint: "传统横" },
  { label: "3:4", value: "3:4", hint: "传统竖" },
];

export const RESOLUTION_TIER_OPTIONS: Array<{
  label: string;
  value: AiImageResolutionTier;
  longEdge: number;
  hint: string;
}> = [
  { label: "1K", value: "1k", longEdge: 1024, hint: "长边 1024px，生成快" },
  { label: "2K", value: "2k", longEdge: 2048, hint: "长边 2048px，适合主视觉" },
  { label: "4K", value: "4k", longEdge: 3840, hint: "长边 3840px，实验性" },
];

export const RESOLUTION_LONG_EDGE: Record<AiImageResolutionTier, number> = Object.fromEntries(
  RESOLUTION_TIER_OPTIONS.map((item) => [item.value, item.longEdge])
) as Record<AiImageResolutionTier, number>;

export const DEFAULT_ASPECT_RATIO: AiImageAspectRatio = "9:16";
export const DEFAULT_RESOLUTION_TIER: AiImageResolutionTier = "1k";
/** gpt-image-2 图生图 API 上限：image_urls 最多 16 张 */
export const MAX_REFERENCE_IMAGES = 16;
/** 上传接口单张上限 */
export const REFERENCE_IMAGE_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
/** 服务端转 data URL 时单张上限（过大易导致生成请求卡住） */
export const REFERENCE_IMAGE_API_MAX_BYTES = 3 * 1024 * 1024;
/** 页面可同时发起的生成请求数 */
export const MAX_CONCURRENT_IMAGE_JOBS = 6;

/** OpenAI gpt-image-2 官方 quality 档位 */
export const DEFAULT_AI_IMAGE_QUALITY: AiImageQuality = "auto";

export const QUALITY_OPTIONS: Array<{ label: string; value: AiImageQuality }> = [
  { label: "Auto", value: "auto" },
  { label: "Low", value: "low" },
  { label: "Med", value: "medium" },
  { label: "High", value: "high" },
];

const ALLOWED_QUALITIES = new Set<AiImageQuality>(QUALITY_OPTIONS.map((item) => item.value));

/** 兼容旧缓存/请求中的 standard、hd（旧 hd 不再映射为 high，统一回落 auto） */
export function normalizeAiImageQuality(value: unknown): AiImageQuality {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "standard" || raw === "hd") return DEFAULT_AI_IMAGE_QUALITY;
  if (ALLOWED_QUALITIES.has(raw as AiImageQuality)) return raw as AiImageQuality;
  return DEFAULT_AI_IMAGE_QUALITY;
}

const QUALITY_DISPLAY_LABEL: Record<AiImageQuality, string> = {
  auto: "Auto",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export function getAiImageQualityLabel(quality: AiImageQuality | string) {
  return QUALITY_DISPLAY_LABEL[normalizeAiImageQuality(quality)];
}

export function getResolutionTierLabel(tier: AiImageResolutionTier) {
  return RESOLUTION_TIER_OPTIONS.find((item) => item.value === tier)?.label ?? tier.toUpperCase();
}
