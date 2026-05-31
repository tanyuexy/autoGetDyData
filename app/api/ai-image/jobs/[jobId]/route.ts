import { NextRequest, NextResponse } from "next/server";
import { getAiImageJob, scheduleAiImageJob } from "@/lib/ai-image/jobService";
import { requireAppSession, resolveOwnerUsername } from "@/lib/auth/requireSession";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await requireAppSession(request);
  if (session instanceof NextResponse) return session;

  try {
    const { jobId } = await params;
    const job = await getAiImageJob(jobId, resolveOwnerUsername(session));
    if (!job) {
      return NextResponse.json({ error: "任务不存在或无权访问" }, { status: 404 });
    }
    if (job.status === "queued") {
      scheduleAiImageJob(job.id);
    }
    return NextResponse.json({ job });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "查询任务失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
