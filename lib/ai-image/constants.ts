import type { AiImageAspectRatio, AiImageResolutionTier } from "./types";

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

export const DEFAULT_ASPECT_RATIO: AiImageAspectRatio = "1:1";
export const DEFAULT_RESOLUTION_TIER: AiImageResolutionTier = "1k";

export function getResolutionTierLabel(tier: AiImageResolutionTier) {
  return RESOLUTION_TIER_OPTIONS.find((item) => item.value === tier)?.label ?? tier.toUpperCase();
}
