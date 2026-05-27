import { NextRequest, NextResponse } from "next/server";
import { requireAppSession, resolveOwnerUsername } from "@/lib/auth/requireSession";
import { updateAiVideoClipFromTask } from "@/lib/ai-video/clipService";
import { getSeedanceTask, resolveSeedanceApiKey } from "@/lib/ai-video/volcengineSeedance";

export const runtime = "nodejs";

async function pollTask(taskId: string, clipId: string | undefined, ownerUsername?: string) {
  const apiKey = resolveSeedanceApiKey();
  const task = await getSeedanceTask(taskId, apiKey);
  const clip = clipId
    ? await updateAiVideoClipFromTask(
        clipId,
        {
          status: task.status,
          videoUrl: task.videoUrl,
          coverUrl: task.coverUrl,
          tokenUsage: task.tokenUsage ?? null,
        },
        ownerUsername
      )
    : null;
  return { task, clip };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await requireAppSession(request);
  if (session instanceof NextResponse) return session;
  try {
    const { taskId } = await params;
    const clipId = request.nextUrl.searchParams.get("clipId") || undefined;
    const result = await pollTask(taskId, clipId, resolveOwnerUsername(session));
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "查询 Seedance 任务失败" }, { status: 400 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await requireAppSession(request);
  if (session instanceof NextResponse) return session;
  try {
    const { taskId } = await params;
    const body = await request.json().catch(() => ({}));
    const clipId = typeof body.clipId === "string" ? body.clipId : undefined;
    const result = await pollTask(taskId, clipId, resolveOwnerUsername(session));
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "查询 Seedance 任务失败" }, { status: 400 });
  }
}
