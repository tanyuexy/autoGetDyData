import { NextRequest, NextResponse } from "next/server";
import { enqueueTask, canStartTask, generateTaskIdWithTime } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    if (!(await canStartTask("review"))) {
      return NextResponse.json(
        { error: "已有作品信息任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({} as any));
    const accounts = Array.isArray(body?.accounts)
      ? body.accounts.map((s: any) => String(s || "").trim()).filter(Boolean)
      : [];
    const startDate = typeof body?.startDate === "string" ? body.startDate.trim() : "";
    const endDate = typeof body?.endDate === "string" ? body.endDate.trim() : "";

    const taskId = generateTaskIdWithTime("review");
    const args = ["scripts/douyin-creator/review.js", ...accounts];

    const configEnv: Record<string, string | undefined> = {};
    if (startDate) configEnv.REVIEW_DATE_START = startDate;
    if (endDate) configEnv.REVIEW_DATE_END = endDate;

    await enqueueTask(taskId, "node", args, {
      namespace: "review",
      env: configEnv,
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
