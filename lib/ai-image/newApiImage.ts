import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getTosConfig } from "@/lib/tos/config";
import { buildTosObjectKey, uploadBufferToTos } from "@/lib/tos/uploadMedia";
import type { AiGeneratedImage, AiImageQuality, AiImageSize } from "./types";

const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_BASE_URL = "https://qiuqiutoken.com";
const GENERATED_IMAGES_DIR = path.join(process.cwd(), "public", "uploads", "ai-image");
const GENERATED_IMAGES_URL_PREFIX = "/uploads/ai-image/";

type NewApiImageItem = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
};

type NewApiImageResponse = {
  data?: NewApiImageItem[];
  error?: { message?: string };
};

export function getAiImageModel() {
  return String(process.env.AI_IMAGE_MODEL || process.env.NEWAPI_IMAGE_MODEL || DEFAULT_MODEL).trim();
}

export function getAiImageApiBaseUrl() {
  return String(
    process.env.AI_IMAGE_API_BASE_URL ||
      process.env.NEWAPI_IMAGE_BASE_URL ||
      process.env.NEWAPI_BASE_URL ||
      DEFAULT_BASE_URL
  )
    .trim()
    .replace(/\/+$/, "");
}

export function getAiImageApiKey() {
  return String(process.env.AI_IMAGE_API_KEY || process.env.NEWAPI_IMAGE_API_KEY || "").trim();
}

function getEndpointUrl() {
  return `${getAiImageApiBaseUrl()}/v1/images/generations`;
}

function inferExtension(contentType: string | null | undefined) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return ".jpg";
  if (normalized.includes("webp")) return ".webp";
  return ".png";
}

function inferContentTypeFromDataUrl(value: string) {
  const match = value.match(/^data:([^;,]+)[;,]/i);
  return match?.[1] || "image/png";
}

function stripBase64Prefix(value: string) {
  return value.replace(/^data:[^,]+,/i, "");
}

async function fetchImageBuffer(url: string) {
  if (url.startsWith("data:")) {
    const contentType = inferContentTypeFromDataUrl(url);
    return {
      buffer: Buffer.from(stripBase64Prefix(url), "base64"),
      contentType,
    };
  }

  const sourceUrl = /^https?:\/\//i.test(url) ? url : new URL(url, getAiImageApiBaseUrl()).toString();
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`下载生成图片失败：HTTP ${response.status}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "image/png",
  };
}

async function persistGeneratedImage(input: {
  buffer: Buffer;
  contentType: string;
  filename: string;
}) {
  const tosConfig = getTosConfig();
  if (tosConfig) {
    const objectKey = buildTosObjectKey(tosConfig.uploadPrefix, `ai-image/${input.filename}`);
    const uploaded = await uploadBufferToTos({
      body: input.buffer,
      objectKey,
      contentType: input.contentType,
    });
    return uploaded.url;
  }

  await mkdir(GENERATED_IMAGES_DIR, { recursive: true });
  await writeFile(path.join(GENERATED_IMAGES_DIR, input.filename), input.buffer);
  return `${GENERATED_IMAGES_URL_PREFIX}${input.filename}`;
}

async function archiveImageItem(item: NewApiImageItem, index: number, request: {
  prompt: string;
  model: string;
  size: AiImageSize;
  quality: AiImageQuality;
}) {
  let buffer: Buffer;
  let contentType = "image/png";

  if (item.b64_json) {
    buffer = Buffer.from(stripBase64Prefix(item.b64_json), "base64");
  } else if (item.url) {
    const fetched = await fetchImageBuffer(item.url);
    buffer = fetched.buffer;
    contentType = fetched.contentType;
  } else {
    throw new Error("图片接口未返回图片数据");
  }

  const id = `img-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`;
  const filename = `${id}${inferExtension(contentType)}`;
  const url = await persistGeneratedImage({ buffer, contentType, filename });

  return {
    id,
    url,
    prompt: request.prompt,
    revisedPrompt: item.revised_prompt || null,
    model: request.model,
    size: request.size,
    quality: request.quality,
    createdAt: new Date().toISOString(),
  } satisfies AiGeneratedImage;
}

export async function generateAiImages(input: {
  prompt: string;
  size: AiImageSize;
  quality: AiImageQuality;
  count: number;
}) {
  const apiKey = getAiImageApiKey();
  if (!apiKey) {
    throw new Error("缺少 AI_IMAGE_API_KEY，请在 .env 中配置图片生成中转站 Key");
  }

  const model = getAiImageModel();
  const response = await fetch(getEndpointUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      n: input.count,
      size: input.size,
      quality: input.quality,
    }),
  });

  const text = await response.text();
  let data: NewApiImageResponse;
  try {
    data = JSON.parse(text) as NewApiImageResponse;
  } catch {
    throw new Error(text.slice(0, 240) || `图片生成接口返回异常：HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(data.error?.message || `图片生成失败：HTTP ${response.status}`);
  }

  const items = Array.isArray(data.data) ? data.data : [];
  if (!items.length) {
    throw new Error("图片生成接口未返回结果");
  }

  const images = await Promise.all(
    items.map((item, index) =>
      archiveImageItem(item, index, {
        prompt: input.prompt,
        model,
        size: input.size,
        quality: input.quality,
      })
    )
  );

  return { images, model };
}
