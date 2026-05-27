export type SeedanceGenerationMode = "text" | "first-frame" | "first-last-frame" | "multimodal-reference";
export type SeedanceReferenceKind = "image" | "video" | "audio";

import type { AiVideoClipTokenUsage } from "@/types";
import { extractTokenUsageFromResponse } from "@/lib/ai-video/tokenUsage";
import {
  getSeedanceDurationConfig,
  normalizeSeedanceDuration,
  type SeedanceDurationConfig,
} from "./volcengineSeedanceDuration";

export { getSeedanceDurationConfig, normalizeSeedanceDuration, type SeedanceDurationConfig };

export interface SeedanceReferenceResource {
  id?: string;
  name?: string;
  kind: SeedanceReferenceKind;
  url: string;
}

export interface SeedanceModelOption {
  label: string;
  value: string;
  generation: string[];
  note: string;
}

export const SEEDANCE_MODELS: SeedanceModelOption[] = [
  {
    label: "Seedance 2.0",
    value: "doubao-seedance-2-0-260128",
    generation: ["文生视频", "首帧生视频", "首尾帧生视频", "多模态参考"],
    note: "质量优先，适合成片主镜头",
  },
  {
    label: "Seedance 2.0 Fast",
    value: "doubao-seedance-2-0-fast-260128",
    generation: ["文生视频", "首帧生视频", "首尾帧生视频", "多模态参考"],
    note: "速度优先，适合批量出片段",
  },
  {
    label: "Seedance 1.5 Pro",
    value: "doubao-seedance-1-5-pro-251215",
    generation: ["文生视频", "首帧生视频"],
    note: "上一代 Pro，适合作为备选模型",
  },
  {
    label: "Seedance 1.0 Pro Fast",
    value: "doubao-seedance-1-0-pro-fast-251015",
    generation: ["文生视频", "首帧生视频"],
    note: "1.0 快速版",
  },
  {
    label: "Seedance 1.0 Pro",
    value: "doubao-seedance-1-0-pro-250528",
    generation: ["文生视频", "首帧生视频"],
    note: "1.0 高质量版",
  },
  {
    label: "Seedance 1.0 Lite T2V",
    value: "doubao-seedance-1-0-lite-t2v-250428",
    generation: ["文生视频"],
    note: "轻量文生视频",
  },
  {
    label: "Seedance 1.0 Lite I2V",
    value: "doubao-seedance-1-0-lite-i2v-250428",
    generation: ["首帧生视频"],
    note: "轻量图生视频",
  },
];

export interface CreateSeedanceTaskInput {
  model: string;
  prompt: string;
  mode: SeedanceGenerationMode;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceResources?: SeedanceReferenceResource[];
  ratio?: string;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  seed?: number | null;
  callbackUrl?: string;
}

export interface NormalizedSeedanceTask {
  id: string;
  status: string;
  videoUrl: string | null;
  coverUrl: string | null;
  tokenUsage?: AiVideoClipTokenUsage | null;
  raw: unknown;
}

const DEFAULT_CREATE_TASK_URL =
  "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";

const LOCAL_UPLOAD_PATH_PREFIX = "/uploads/ai-video/";

function getCreateTaskUrl() {
  return process.env.VOLCENGINE_SEEDANCE_TASK_URL || DEFAULT_CREATE_TASK_URL;
}

export function getServerSeedanceApiKey() {
  return (
    process.env.VOLCENGINE_ARK_API_KEY ||
    process.env.ARK_API_KEY ||
    process.env.VOLCENGINE_API_KEY ||
    ""
  ).trim();
}

export function getSeedanceCallbackUrlConfig() {
  const callbackUrl = (process.env.AI_VIDEO_CALLBACK_URL || "").trim();
  return {
    showCallbackUrl: Boolean(callbackUrl),
    defaultCallbackUrl: callbackUrl || undefined,
  };
}

export function resolveSeedanceApiKey(explicitApiKey?: string) {
  const key = (explicitApiKey || "").trim() || getServerSeedanceApiKey();
  if (!key) {
    throw new Error(
      "缺少火山方舟 API Key。请设置 VOLCENGINE_ARK_API_KEY / ARK_API_KEY，或在页面填入本次请求密钥。"
    );
  }
  return key;
}

function cleanUrl(value?: string) {
  const trimmed = (value || "").trim();
  return trimmed || undefined;
}

function isNonPublicImageUrl(url: string) {
  if (url.startsWith("data:image/")) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return true;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function mimeFromExtension(ext: string) {
  const normalized = ext.toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") return "jpeg";
  if (normalized === "webp") return "webp";
  if (normalized === "gif") return "gif";
  if (normalized === "bmp") return "bmp";
  return "png";
}

async function readLocalUploadAsDataUrl(url: string) {
  const { readFile } = await import("fs/promises");
  const path = await import("path");

  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.startsWith("/") ? url : `/${url}`;
  }

  const prefix = LOCAL_UPLOAD_PATH_PREFIX;
  if (!pathname.startsWith(prefix)) return null;

  const filename = pathname.slice(prefix.length);
  if (!filename || filename.includes("/") || filename.includes("..")) return null;

  const filePath = path.join(process.cwd(), "public", "uploads", "ai-video", filename);
  const buffer = await readFile(filePath);
  const mime = mimeFromExtension(path.extname(filename).slice(1));
  return `data:image/${mime};base64,${buffer.toString("base64")}`;
}

export async function resolveSeedanceImageUrl(url?: string) {
  const cleaned = cleanUrl(url);
  if (!cleaned) return undefined;
  if (cleaned.startsWith("data:image/")) return cleaned;

  if (isNonPublicImageUrl(cleaned)) {
    const dataUrl = await readLocalUploadAsDataUrl(cleaned);
    if (dataUrl) return dataUrl;
    throw new Error(
      "图片 URL 无法被火山引擎访问（localhost/内网）。请通过页面上传图片，或配置 PUBLIC_BASE_URL 为公网可访问地址。"
    );
  }

  return cleaned;
}

function isProbablyLocalUrl(url: string) {
  if (url.startsWith("/")) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return true;
  }
}

async function resolveSeedanceReferenceResource(resource: SeedanceReferenceResource) {
  const url = cleanUrl(resource.url);
  if (!url) throw new Error("参考资源缺少 URL");

  if (resource.kind === "image") {
    const resolvedUrl = await resolveSeedanceImageUrl(url);
    if (!resolvedUrl) throw new Error("图片参考资源缺少 URL");
    return { ...resource, url: resolvedUrl };
  }

  if (isProbablyLocalUrl(url)) {
    throw new Error(
      `${resource.kind === "video" ? "视频" : "音频"}参考资源需要公网可访问 URL。请配置 PUBLIC_BASE_URL，或先上传到 TOS/公网存储后再使用。`
    );
  }

  return { ...resource, url };
}

async function resolveSeedanceReferenceResources(resources?: SeedanceReferenceResource[]) {
  if (!Array.isArray(resources)) return [];
  const filtered = resources
    .filter((item) => item && item.kind && cleanUrl(item.url))
    .slice(0, 20);
  return Promise.all(filtered.map((item) => resolveSeedanceReferenceResource(item)));
}

function appendReferenceResources(
  content: Array<Record<string, unknown>>,
  resources: SeedanceReferenceResource[]
) {
  for (const resource of resources) {
    if (resource.kind === "image") {
      content.push({
        type: "image_url",
        image_url: { url: resource.url },
        role: "reference_image",
      });
    } else if (resource.kind === "video") {
      content.push({
        type: "video_url",
        video_url: { url: resource.url },
        role: "reference_video",
      });
    } else if (resource.kind === "audio") {
      content.push({
        type: "audio_url",
        audio_url: { url: resource.url },
        role: "reference_audio",
      });
    }
  }
}

function buildContent(input: CreateSeedanceTaskInput) {
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: input.prompt.trim() },
  ];

  const firstFrameUrl = cleanUrl(input.firstFrameUrl);
  const lastFrameUrl = cleanUrl(input.lastFrameUrl);
  const referenceResources = input.referenceResources || [];
  // Seedance 不允许 first_frame/last_frame 与 reference_* 混用；有参考媒体时走多模态参考模式
  const useMultimodalReference = referenceResources.length > 0;

  if (useMultimodalReference) {
    if (referenceResources.every((resource) => resource.kind === "audio")) {
      throw new Error("多模态参考不能只传音频，请至少添加 1 个参考图片或视频");
    }
    appendReferenceResources(content, referenceResources);
    return content;
  }

  if (input.mode === "first-frame" || input.mode === "first-last-frame") {
    if (!firstFrameUrl) throw new Error("首帧模式需要填写首帧图片 URL");
    content.push({
      type: "image_url",
      image_url: { url: firstFrameUrl },
      role: "first_frame",
    });
  }

  if (input.mode === "first-last-frame") {
    if (!lastFrameUrl) throw new Error("首尾帧模式需要填写尾帧图片 URL");
    content.push({
      type: "image_url",
      image_url: { url: lastFrameUrl },
      role: "last_frame",
    });
  }

  return content;
}

export function buildSeedanceTaskPayload(input: CreateSeedanceTaskInput) {
  if (!input.model) throw new Error("请选择 Seedance 模型");
  if (!input.prompt?.trim()) throw new Error("请输入视频提示词");

  const payload: Record<string, unknown> = {
    model: input.model,
    content: buildContent(input),
    watermark: input.watermark ?? false,
  };

  if (input.ratio) payload.ratio = input.ratio;
  if (input.resolution) payload.resolution = input.resolution;
  payload.duration = normalizeSeedanceDuration(input.model, input.duration);
  if (typeof input.generateAudio === "boolean") {
    payload.generate_audio = input.generateAudio;
  }
  if (typeof input.seed === "number" && Number.isFinite(input.seed)) {
    payload.seed = input.seed;
  }
  if (input.callbackUrl?.trim()) payload.callback_url = input.callbackUrl.trim();

  return payload;
}

function getErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, any>;
  return (
    record.error?.message ||
    record.message ||
    record.msg ||
    record.error ||
    fallback
  );
}

export async function createSeedanceTask(input: CreateSeedanceTaskInput, apiKey: string) {
  const resolvedInput: CreateSeedanceTaskInput = {
    ...input,
    firstFrameUrl: await resolveSeedanceImageUrl(input.firstFrameUrl),
    lastFrameUrl: await resolveSeedanceImageUrl(input.lastFrameUrl),
    referenceResources: await resolveSeedanceReferenceResources(input.referenceResources),
  };
  const payload = buildSeedanceTaskPayload(resolvedInput);
  const res = await fetch(getCreateTaskUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(String(getErrorMessage(data, `Seedance 创建任务失败：HTTP ${res.status}`)));
  }

  return {
    task: normalizeSeedanceTask(data),
    raw: data,
    requestPayload: payload,
  };
}

export async function getSeedanceTask(taskId: string, apiKey: string) {
  const endpoint = `${getCreateTaskUrl().replace(/\/$/, "")}/${encodeURIComponent(taskId)}`;
  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(String(getErrorMessage(data, `Seedance 查询任务失败：HTTP ${res.status}`)));
  }
  return normalizeSeedanceTask(data);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNestedString(data: any, keys: string[]): string | null {
  if (!data || typeof data !== "object") return null;
  for (const key of keys) {
    const direct = firstString(data[key]);
    if (direct) return direct;
  }
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = firstNestedString(item, keys);
        if (nested) return nested;
      }
      continue;
    }
    if (value && typeof value === "object") {
      const nested = firstNestedString(value, keys);
      if (nested) return nested;
    }
  }
  return null;
}

function findVideoUrl(data: any): string | null {
  if (!data || typeof data !== "object") return null;

  if (
    firstString(data.type)?.includes("video") ||
    data.video ||
    data.video_url ||
    data.videoUrl
  ) {
    const direct = firstString(
      data.url,
      data.video_url?.url,
      data.videoUrl?.url,
      data.video?.url
    );
    if (direct) return direct;
  }

  for (const [key, value] of Object.entries(data)) {
    if (key.toLowerCase().includes("video") && value && typeof value === "object") {
      const direct = firstString((value as any).url);
      if (direct) return direct;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = findVideoUrl(item);
        if (nested) return nested;
      }
    } else if (value && typeof value === "object") {
      const nested = findVideoUrl(value);
      if (nested) return nested;
    }
  }
  return null;
}

export function normalizeSeedanceTask(data: any): NormalizedSeedanceTask {
  const root = data?.data && typeof data.data === "object" ? data.data : data;
  const id = firstString(root?.id, root?.task_id, root?.taskId, data?.id, data?.task_id) || "";
  const status =
    firstString(root?.status, root?.state, root?.task_status, data?.status, data?.state) || "unknown";

  return {
    id,
    status,
    videoUrl:
      firstNestedString(root, [
        "video_url",
        "videoUrl",
        "result_url",
        "output_url",
        "download_url",
        "play_url",
      ]) || findVideoUrl(root),
    coverUrl: firstNestedString(root, [
      "cover_url",
      "coverUrl",
      "poster_url",
      "thumbnail_url",
      "image_url",
    ]),
    tokenUsage: extractTokenUsageFromResponse(data),
    raw: data,
  };
}
