import { NextRequest, NextResponse } from "next/server";
import { requireAppSession, resolveOwnerUsername } from "@/lib/auth/requireSession";
import { createAiImageJob, scheduleAiImageJob } from "@/lib/ai-image/jobService";
import {
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
import type { AiImageJobRequest, AiImageSize } from "@/lib/ai-image/types";

export const runtime = "nodejs";

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

function buildJobRequest(body: Record<string, unknown>): AiImageJobRequest {
  const aspectRatio = normalizeAspectRatio(body.aspectRatio);
  const resolution = normalizeResolutionTier(body.resolution);
  const rawRefs = body.referenceImageUrls;
  const referenceImageUrls = Array.isArray(rawRefs)
    ? rawRefs
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, MAX_REFERENCE_IMAGES)
    : [];

  return {
    prompt: String(body.prompt || "").trim(),
    size: resolveRequestSize(body),
    quality: normalizeAiImageQuality(body.quality),
    count: normalizeCount(body.count),
    aspectRatio,
    resolution,
    referenceImageUrls,
  };
}

export async function GET() {
  return NextResponse.json({
    model: getAiImageModel(),
    hasServerApiKey: Boolean(getAiImageApiKey()),
    baseUrl: getAiImageApiBaseUrl(),
    qualities: QUALITY_OPTIONS.map((item) => item.value),
    asyncJobs: true,
  });
}

export async function POST(request: NextRequest) {
  const session = await requireAppSession(request);
  if (session instanceof NextResponse) return session;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const jobRequest = buildJobRequest(body);
    if (!jobRequest.prompt) {
      return NextResponse.json({ error: "请先输入图片提示词" }, { status: 400 });
    }
    if (jobRequest.prompt.length > 4000) {
      return NextResponse.json({ error: "图片提示词不能超过 4000 字" }, { status: 400 });
    }

    const job = await createAiImageJob({
      request: jobRequest,
      ownerUsername: resolveOwnerUsername(session),
    });
    scheduleAiImageJob(job.id);

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      job,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "创建图片生成任务失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
