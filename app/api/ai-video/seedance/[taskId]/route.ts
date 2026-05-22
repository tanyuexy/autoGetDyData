import { NextRequest, NextResponse } from "next/server";
import { updateAiVideoClipFromTask } from "@/lib/aiVideoClipService";
import { getSeedanceTask, resolveSeedanceApiKey } from "@/lib/volcengineSeedance";

export const runtime = "nodejs";

async function pollTask(taskId: string, clipId?: string) {
  const apiKey = resolveSeedanceApiKey();
  const task = await getSeedanceTask(taskId, apiKey);
  const clip = clipId ? await updateAiVideoClipFromTask(clipId, task) : null;
  return { task, clip };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const clipId = request.nextUrl.searchParams.get("clipId") || undefined;
    const result = await pollTask(taskId, clipId);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "查询 Seedance 任务失败" }, { status: 400 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const body = await request.json().catch(() => ({}));
    const clipId = typeof body.clipId === "string" ? body.clipId : undefined;
    const result = await pollTask(taskId, clipId);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "查询 Seedance 任务失败" }, { status: 400 });
  }
}
