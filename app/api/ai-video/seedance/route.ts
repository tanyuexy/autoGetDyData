import { NextRequest, NextResponse } from "next/server";
import { isSelectableSeedanceModel } from "@/lib/ai-video/constants";
import {
  SEEDANCE_MODELS,
  createSeedanceTask,
  getSeedanceDurationConfig,
  getSeedanceCallbackUrlConfig,
  getServerSeedanceApiKey,
  resolveSeedanceApiKey,
  type CreateSeedanceTaskInput,
} from "@/lib/ai-video/volcengineSeedance";

export const runtime = "nodejs";

export async function GET() {
  const callbackConfig = getSeedanceCallbackUrlConfig();
  return NextResponse.json({
    models: SEEDANCE_MODELS.map((item) => ({
      ...item,
      duration: getSeedanceDurationConfig(item.value),
    })),
    hasServerApiKey: Boolean(getServerSeedanceApiKey()),
    showCallbackUrl: callbackConfig.showCallbackUrl,
    defaultCallbackUrl: callbackConfig.defaultCallbackUrl,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const model = String(body.model || "").trim();
    if (!isSelectableSeedanceModel(model)) {
      return NextResponse.json({ error: "仅支持 Seedance 2.0 系列模型" }, { status: 400 });
    }
    const apiKey = resolveSeedanceApiKey();
    const callbackConfig = getSeedanceCallbackUrlConfig();
    const input: CreateSeedanceTaskInput = {
      model,
      prompt: body.prompt,
      mode: body.mode,
      firstFrameUrl: toAbsoluteUrl(request, body.firstFrameUrl),
      lastFrameUrl: toAbsoluteUrl(request, body.lastFrameUrl),
      referenceResources: Array.isArray(body.referenceResources)
        ? body.referenceResources.map((item: any) => ({
            id: item.id,
            name: item.name,
            kind: item.kind,
            url: toAbsoluteUrl(request, item.url),
          }))
        : [],
      ratio: body.ratio,
      resolution: body.resolution,
      duration: body.duration,
      generateAudio: body.generateAudio,
      watermark: body.watermark,
      seed: body.seed,
      callbackUrl: String(body.callbackUrl || callbackConfig.defaultCallbackUrl || "").trim() || undefined,
    };

    const result = await createSeedanceTask(input, apiKey);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "创建 Seedance 任务失败" }, { status: 400 });
  }
}

function toAbsoluteUrl(request: NextRequest, value?: string) {
  const url = String(value || "").trim();
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  const origin = process.env.PUBLIC_BASE_URL || request.nextUrl.origin;
  return new URL(url, origin).toString();
}
