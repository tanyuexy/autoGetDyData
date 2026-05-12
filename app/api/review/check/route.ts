import { NextRequest, NextResponse } from "next/server";
import { enqueueTask, canStartTask, generateTaskIdWithTime } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    if (!(await canStartTask("review"))) {
      return NextResponse.json(
        { error: "已有稿文审核任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({} as any));
    const accounts = Array.isArray(body?.accounts)
      ? body.accounts.map((s: any) => String(s || "").trim()).filter(Boolean)
      : [];
    const reviewScope = ["all", "approved", "under_review", "rejected"].includes(String(body?.reviewScope || ""))
      ? String(body.reviewScope)
      : "all";

    const taskId = generateTaskIdWithTime("review");
    const args = ["scripts/douyin-creator/review.js", `--review-scope=${reviewScope}`, ...accounts];

    await enqueueTask(taskId, "node", args, { namespace: "review" });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
