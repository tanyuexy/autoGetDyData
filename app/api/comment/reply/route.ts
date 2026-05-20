import { NextRequest, NextResponse } from "next/server";
import { enqueueTask, canStartTask, generateTaskIdWithTime } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    if (!(await canStartTask("comment"))) {
      return NextResponse.json(
        { error: "已有评论任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({} as any));
    const accountName = String(body?.accountName || "").trim();
    const awemeId = String(body?.awemeId || "").trim();
    const text = String(body?.text || "").trim();
    const replyToCid = String(body?.replyToCid || "").trim();

    if (!accountName || !awemeId || !text) {
      return NextResponse.json(
        { error: "缺少必要参数: accountName, awemeId, text" },
        { status: 400 }
      );
    }

    const taskId = generateTaskIdWithTime("reply");
    const args = [
      "scripts/douyin-creator/commands/reply-comment.js",
      `--account=${accountName}`,
      `--aweme-id=${awemeId}`,
      `--text=${text}`,
    ];
    if (replyToCid) {
      args.push(`--reply-to-cid=${replyToCid}`);
    }

    await enqueueTask(taskId, "node", args, { namespace: "comment" });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
