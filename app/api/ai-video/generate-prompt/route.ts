import { NextRequest, NextResponse } from "next/server";
import {
  generateSeedancePrompts,
  getSeedancePromptModelName,
  type GenerateSeedancePromptInput,
  type SeedancePromptReferenceInput,
} from "@/lib/ai-video/seedancePromptGenerator";
import { DEFAULT_SEEDANCE_MODEL } from "@/lib/ai-video/constants";
import type { GenerationMode } from "@/lib/ai-video/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function getServerMiniMaxApiKey() {
  return (
    process.env.MINIMAX_API_KEY?.trim() ||
    process.env.MINIMAX_TOKEN_PLAN_KEY?.trim() ||
    ""
  );
}

function isGenerationMode(value: unknown): value is GenerationMode {
  return value === "text" || value === "first-frame" || value === "first-last-frame";
}

function normalizeReferences(input: unknown): SeedancePromptReferenceInput[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const kind = record.kind;
      const name = String(record.name || "").trim();
      const token = String(record.token || "").trim();
      if (kind !== "image" && kind !== "video" && kind !== "audio") return null;
      if (!name || !token) return null;
      return { kind, name, token };
    })
    .filter(Boolean) as SeedancePromptReferenceInput[];
}

export async function GET() {
  return NextResponse.json({
    hasMiniMaxApiKey: Boolean(getServerMiniMaxApiKey()),
    model: getSeedancePromptModelName(),
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!getServerMiniMaxApiKey()) {
      return NextResponse.json(
        { error: "缺少 MiniMax API Key，请设置 MINIMAX_API_KEY" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const brief = String(body.brief || "").trim();
    if (!brief) {
      return NextResponse.json({ error: "请先描述视频创意" }, { status: 400 });
    }

    const mode = isGenerationMode(body.mode) ? body.mode : "first-frame";
    const input: GenerateSeedancePromptInput = {
      brief,
      mode,
      model: String(body.model || "").trim() || DEFAULT_SEEDANCE_MODEL,
      duration: Number(body.duration) || 5,
      ratio: String(body.ratio || "9:16").trim(),
      resolution: String(body.resolution || "720p").trim(),
      generateAudio: Boolean(body.generateAudio),
      referenceResources: normalizeReferences(body.referenceResources),
      hasFirstFrame: Boolean(body.hasFirstFrame),
      hasLastFrame: Boolean(body.hasLastFrame),
      stylePreference: String(body.stylePreference || "").trim() || undefined,
      existingPrompt: String(body.existingPrompt || "").trim() || undefined,
    };

    const result = await generateSeedancePrompts(input);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "生成提示词失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
