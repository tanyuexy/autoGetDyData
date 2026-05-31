export type AiImageSize = "auto" | `${number}x${number}`;

export type AiImageAspectRatio =
  | "auto"
  | "1:1"
  | "3:2"
  | "2:3"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4";

export type AiImageResolutionTier = "1k" | "2k" | "4k";

/** gpt-image-2 官方 quality：auto / low / medium / high */
export type AiImageQuality = "auto" | "low" | "medium" | "high";

export interface AiGeneratedImage {
  id: string;
  url: string;
  prompt: string;
  revisedPrompt?: string | null;
  model: string;
  size: AiImageSize;
  quality: AiImageQuality;
  createdAt: string;
}

export type AiImageViewMode = "gallery" | "list";

export interface AiImageReference {
  id: string;
  url: string;
  name: string;
  size?: number;
}

export const AI_IMAGE_SETTINGS_CACHE_VERSION = 2;

export interface AiImageCachedSettings {
  /** 递增后用于迁移本地默认值（如 quality 默认 auto） */
  settingsVersion?: number;
  prompt?: string;
  referenceImages?: AiImageReference[];
  /** @deprecated 旧版尺寸字段，读取时会迁移到 aspectRatio + resolution */
  size?: AiImageSize;
  aspectRatio?: AiImageAspectRatio;
  resolution?: AiImageResolutionTier;
  quality?: AiImageQuality;
  count?: number;
  viewMode?: AiImageViewMode;
}
