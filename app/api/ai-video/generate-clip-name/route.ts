import { NextRequest, NextResponse } from "next/server";
import {
  fallbackClipName,
  generateClipNameFromPrompt,
  getClipNameModelName,
} from "@/lib/ai-video/clipNameGenerator";

export const runtime = "nodejs";
export const maxDuration = 30;

function getServerMiniMaxApiKey() {
  return (
    process.env.MINIMAX_API_KEY?.trim() ||
    process.env.MINIMAX_TOKEN_PLAN_KEY?.trim() ||
    ""
  );
}

export async function GET() {
  return NextResponse.json({
    hasMiniMaxApiKey: Boolean(getServerMiniMaxApiKey()),
    model: getClipNameModelName(),
  });
}

export async function POST(request: NextRequest) {
  const prompt = String((await request.json().catch(() => ({}))).prompt || "").trim();
  const fallback = fallbackClipName(prompt);

  if (!prompt) {
    return NextResponse.json({ name: fallback, source: "fallback" });
  }

  if (!getServerMiniMaxApiKey()) {
    return NextResponse.json({ name: fallback, source: "fallback" });
  }

  try {
    const generated = await generateClipNameFromPrompt(prompt);
    if (generated) {
      return NextResponse.json({ name: generated, source: "minimax" });
    }
    return NextResponse.json({ name: fallback, source: "fallback" });
  } catch {
    return NextResponse.json({ name: fallback, source: "fallback" });
  }
}
