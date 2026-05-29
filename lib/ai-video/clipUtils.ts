import type { UploadFile } from "antd/es/upload/interface";
import type { SemanticTagPreset } from "@/lib/semanticTagStyles";
import { SEEDANCE_MODEL_LABEL_BY_VALUE } from "./constants";
import { readCachedUploadFiles, serializeUploadFiles } from "./cache";
import type {
  ClipFormSnapshot,
  ClipItem,
  GenerationMode,
  ReferenceKind,
  ReferenceResource,
} from "./types";

export function buildClipFormSnapshot(input: {
  model: string;
  mode: GenerationMode;
  prompt: string;
  firstFrameUrl: string;
  lastFrameUrl: string;
  firstFrameFiles: UploadFile[];
  lastFrameFiles: UploadFile[];
  referenceResources: ReferenceResource[];
  ratio: string;
  resolution: string;
  duration: number;
  generateAudio: boolean;
  watermark: boolean;
  seed: number | null;
  callbackUrl: string;
}): ClipFormSnapshot {
  return {
    model: input.model,
    mode: input.mode,
    prompt: input.prompt,
    firstFrameUrl: input.firstFrameUrl,
    lastFrameUrl: input.lastFrameUrl,
    firstFrameFiles: serializeUploadFiles(input.firstFrameFiles),
    lastFrameFiles: serializeUploadFiles(input.lastFrameFiles),
    referenceResources: input.referenceResources.map((item) => ({ ...item })),
    ratio: input.ratio,
    resolution: input.resolution,
    duration: input.duration,
    generateAudio: input.generateAudio,
    watermark: input.watermark,
    seed: input.seed,
    callbackUrl: input.callbackUrl,
  };
}

function inferMediaNameFromUrl(url: string, fallbackPrefix: string) {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    const basename = pathname.split("/").filter(Boolean).pop();
    if (basename) return decodeURIComponent(basename);
  } catch {}
  return `${fallbackPrefix}资源`;
}

export function ensureUploadFilesFromUrl(url: string, files: unknown, defaultName: string): UploadFile[] {
  const restored = readCachedUploadFiles(files);
  if (restored.length) return restored;
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return [];
  const name = inferMediaNameFromUrl(normalizedUrl, defaultName);
  const uid = `restored-${defaultName}-${normalizedUrl}`;
  return [
    {
      uid,
      name,
      status: "done",
      url: normalizedUrl,
      thumbUrl: normalizedUrl,
    },
  ];
}

export function resolveClipRestoreSnapshot(record: ClipItem): ClipFormSnapshot | null {
  if (record.model === "manual") return null;

  const base =
    record.formSnapshot ??
    ({
      model: record.model,
      mode: record.mode,
      prompt: record.prompt,
      firstFrameUrl: "",
      lastFrameUrl: "",
      firstFrameFiles: [],
      lastFrameFiles: [],
      referenceResources: [],
      ratio: record.ratio,
      resolution: record.resolution,
      duration: record.duration,
      generateAudio: false,
      watermark: false,
      seed: null,
      callbackUrl: "",
    } satisfies ClipFormSnapshot);

  const referenceResources = base.referenceResources?.length ? base.referenceResources : [];
  const firstFrameUrl = base.firstFrameUrl || "";
  const lastFrameUrl = base.lastFrameUrl || "";

  return {
    ...base,
    firstFrameUrl,
    lastFrameUrl,
    referenceResources: referenceResources.map((item) => ({ ...item })),
    firstFrameFiles: ensureUploadFilesFromUrl(firstFrameUrl, base.firstFrameFiles, "首帧图片"),
    lastFrameFiles: ensureUploadFilesFromUrl(lastFrameUrl, base.lastFrameFiles, "尾帧图片"),
  };
}

export function getStatusPreset(status: string): SemanticTagPreset {
  const normalized = status.toLowerCase();
  if (["succeeded", "success", "completed", "done"].includes(normalized)) return "success";
  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) return "error";
  if (["queued", "created", "pending"].includes(normalized)) return "default";
  if (["running", "processing", "in_progress", "in-progress"].includes(normalized)) return "processing";
  return "default";
}

export function formatClipStatusLabel(status: string) {
  const normalized = status.toLowerCase();
  const labels: Record<string, string> = {
    running: "生成中",
    processing: "生成中",
    in_progress: "生成中",
    "in-progress": "生成中",
    queued: "排队中",
    created: "已创建",
    pending: "待生成",
    succeeded: "已完成",
    success: "已完成",
    completed: "已完成",
    done: "已完成",
    failed: "失败",
    error: "失败",
    cancelled: "已取消",
    canceled: "已取消",
    unknown: "未知",
  };
  return labels[normalized] || status || "未知";
}

export function isClipCompleted(status: string) {
  return ["succeeded", "success", "completed", "done"].includes(status.toLowerCase());
}

export function isFinished(status: string) {
  return ["succeeded", "success", "completed", "done", "failed", "error", "cancelled", "canceled"].includes(
    status.toLowerCase()
  );
}

export function formatClipModelLabel(modelValue: string): string {
  const model = String(modelValue || "").trim();
  if (!model) return "—";
  if (model === "manual") return "手动上传";
  return SEEDANCE_MODEL_LABEL_BY_VALUE[model] ?? model;
}

export function createClipId() {
  return `clip-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createReferenceId() {
  return `ref-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getReferenceKind(file: File): ReferenceKind | null {
  const ext = file.name.toLowerCase();
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type) || /\.(jpe?g|png|webp)$/.test(ext)) {
    return "image";
  }
  if (
    ["video/mp4", "video/quicktime", "video/webm"].includes(file.type) ||
    /\.(mp4|mov|webm)$/.test(ext)
  ) {
    return "video";
  }
  if (
    ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac"].includes(file.type) ||
    /\.(mp3|wav|m4a|aac)$/.test(ext)
  ) {
    return "audio";
  }
  return null;
}

export function getReferenceKindLabel(kind: ReferenceKind) {
  if (kind === "image") return "图片";
  if (kind === "video") return "视频";
  return "音频";
}

export function validateReferenceFile(file: File): { ok: true; kind: ReferenceKind } | { ok: false; error: string } {
  const kind = getReferenceKind(file);
  if (!kind) {
    return {
      ok: false,
      error: "仅支持 JPG、PNG、WebP 图片，MP4、MOV、WebM 视频，或 MP3、WAV、M4A、AAC 音频",
    };
  }
  const maxMb = kind === "video" ? 200 : kind === "audio" ? 80 : 12;
  if (file.size / 1024 / 1024 > maxMb) {
    return { ok: false, error: `${getReferenceKindLabel(kind)}不能超过 ${maxMb}MB` };
  }
  return { ok: true, kind };
}

export function formatFileSize(size?: number) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

export function normalizeReferencePrompt(value: string) {
  return value.replace(/@(图片|视频|音频)\s*(\d+)/g, "$1$2");
}

export function getFirstImageReference(resources: ReferenceResource[]) {
  return resources.find((item) => item.kind === "image");
}

export function getReferenceLabel(resources: ReferenceResource[], resource: ReferenceResource) {
  const sameKindResources = resources.filter((item) => item.kind === resource.kind);
  const index = sameKindResources.findIndex((item) => item.id === resource.id) + 1;
  return `${getReferenceKindLabel(resource.kind)}${Math.max(1, index)}`;
}
