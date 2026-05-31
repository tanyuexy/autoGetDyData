import { NextRequest, NextResponse } from "next/server";
import { requireAppSession } from "@/lib/auth/requireSession";
import {
  generateAiImages,
  getAiImageApiBaseUrl,
  getAiImageApiKey,
  getAiImageModel,
} from "@/lib/ai-image/newApiImage";
import {
  normalizeAspectRatio,
  normalizeImageSize,
  normalizeResolutionTier,
  resolveImageDimensions,
} from "@/lib/ai-image/sizeUtils";
import { MAX_REFERENCE_IMAGES, normalizeAiImageQuality, QUALITY_OPTIONS } from "@/lib/ai-image/constants";
import type { AiImageSize } from "@/lib/ai-image/types";

export const runtime = "nodejs";
export const maxDuration = 120;

function normalizeCount(value: unknown) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 1;
  return Math.min(4, Math.max(1, Math.floor(count)));
}

function resolveRequestSize(body: Record<string, unknown>): AiImageSize {
  if (body.size !== undefined && body.size !== null && String(body.size).trim() !== "") {
    return normalizeImageSize(body.size);
  }
  const aspectRatio = normalizeAspectRatio(body.aspectRatio);
  const resolution = normalizeResolutionTier(body.resolution);
  return resolveImageDimensions(aspectRatio, resolution);
}

export async function GET() {
  return NextResponse.json({
    model: getAiImageModel(),
    hasServerApiKey: Boolean(getAiImageApiKey()),
    baseUrl: getAiImageApiBaseUrl(),
    qualities: QUALITY_OPTIONS.map((item) => item.value),
  });
}

export async function POST(request: NextRequest) {
  const session = await requireAppSession(request);
  if (session instanceof NextResponse) return session;

  try {
    const body = await request.json().catch(() => ({}));
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      return NextResponse.json({ error: "请先输入图片提示词" }, { status: 400 });
    }
    if (prompt.length > 4000) {
      return NextResponse.json({ error: "图片提示词不能超过 4000 字" }, { status: 400 });
    }

    const rawRefs = (body as Record<string, unknown>).referenceImageUrls;
    const referenceImageUrls = Array.isArray(rawRefs)
      ? rawRefs
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .slice(0, MAX_REFERENCE_IMAGES)
      : [];

    const result = await generateAiImages({
      prompt,
      size: resolveRequestSize(body as Record<string, unknown>),
      quality: normalizeAiImageQuality(body.quality),
      count: normalizeCount(body.count),
      referenceImageUrls,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "图片生成失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
