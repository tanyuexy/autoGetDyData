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

export type AiImageQuality = "auto" | "standard" | "hd";

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

export interface AiImageCachedSettings {
  prompt?: string;
  /** @deprecated 旧版尺寸字段，读取时会迁移到 aspectRatio + resolution */
  size?: AiImageSize;
  aspectRatio?: AiImageAspectRatio;
  resolution?: AiImageResolutionTier;
  quality?: AiImageQuality;
  count?: number;
  viewMode?: AiImageViewMode;
}
