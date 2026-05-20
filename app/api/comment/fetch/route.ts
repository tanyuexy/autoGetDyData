import { NextRequest, NextResponse } from "next/server";
import { enqueueTask, canStartTask, generateTaskIdWithTime } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    if (!(await canStartTask("comment"))) {
      return NextResponse.json(
        { error: "已有评论抓取任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({} as any));
    const accounts = Array.isArray(body?.accounts)
      ? body.accounts.map((s: any) => String(s || "").trim()).filter(Boolean)
      : [];
    const maxWorks = Number(body?.maxWorks) || 10;

    if (accounts.length === 0) {
      return NextResponse.json({ error: "请选择至少一个账号" }, { status: 400 });
    }

    const taskId = generateTaskIdWithTime("comment");
    const args = ["scripts/douyin-creator/commands/comment.js", `--max-works=${maxWorks}`, ...accounts];

    await enqueueTask(taskId, "node", args, { namespace: "comment" });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
