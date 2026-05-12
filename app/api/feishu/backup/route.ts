import { NextRequest, NextResponse } from "next/server";
import { canStartTask, generateTaskIdWithTime } from "@/lib/taskManager";
import { startApiTask } from "@/lib/apiTaskRunner";
import { backupFeishuBitable } from "@/lib/feishu/service";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { profiles = "creator,shop" } = body;

    if (!(await canStartTask("feishu"))) {
      return NextResponse.json(
        { error: "已有飞书任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    const taskId = generateTaskIdWithTime("feishu-backup");
    startApiTask(taskId, "feishu", { target: String(profiles) }, async () => {
      await backupFeishuBitable({ profiles: String(profiles || "creator,shop") });
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
