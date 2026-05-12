import { NextRequest, NextResponse } from "next/server";
import { canStartTask, generateTaskIdWithTime } from "@/lib/taskManager";
import { startApiTask } from "@/lib/apiTaskRunner";
import { syncFeishuBitable } from "@/lib/feishu/service";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    if (!(await canStartTask("creator-export"))) {
      return NextResponse.json(
        { error: "已有抖创同步任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({} as any));
    const accounts = Array.isArray(body?.accounts)
      ? body.accounts.map((s: any) => String(s || "").trim()).filter(Boolean)
      : [];

    const taskId = generateTaskIdWithTime("creator-feishu-sync");
    startApiTask(taskId, "creator-export", { target: accounts.join(",") || "creator" }, async () => {
      await syncFeishuBitable({ profile: "creator" });
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
