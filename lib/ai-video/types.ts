import type { UploadFile } from "antd/es/upload/interface";
import type { AiVideoClip, AiVideoClipFormSnapshot, AiVideoReferenceResource } from "@/types";

export type GenerationMode = "text" | "first-frame" | "first-last-frame";
export type ReferenceKind = "image" | "video" | "audio";

export interface SeedanceModelOption {
  label: string;
  value: string;
  generation: string[];
  note: string;
}

export type ClipItem = AiVideoClip;
export type ClipFormSnapshot = AiVideoClipFormSnapshot;
export type ReferenceResource = AiVideoReferenceResource;

export interface AiVideoCachedConfig {
  model?: string;
  mode?: GenerationMode;
  prompt?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  firstFrameFiles?: UploadFile[];
  lastFrameFiles?: UploadFile[];
  ratio?: string;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  seed?: number | null;
  callbackUrl?: string;
}
