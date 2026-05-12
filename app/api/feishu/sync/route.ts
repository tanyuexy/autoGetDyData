import { NextRequest, NextResponse } from "next/server";
import { canStartTask, generateTaskIdWithTime } from "@/lib/taskManager";
import { startApiTask } from "@/lib/apiTaskRunner";
import { syncFeishuBitable } from "@/lib/feishu/service";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { profile = "creator", keepRows } = body;

    if (!(await canStartTask("feishu"))) {
      return NextResponse.json(
        { error: "已有飞书任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    let defaultKeepRows = 0;
    try {
      const { getConfig } = require("@/lib/configService");
      const cfg = await getConfig();
      defaultKeepRows = Number(cfg?.feishu?.shop?.keepRows ?? 0) || 0;
    } catch { }

    const taskId = generateTaskIdWithTime("feishu-sync");
    const effectiveKeepRows =
      keepRows !== undefined ? Number(keepRows) : profile === "shop" ? defaultKeepRows : 0;

    startApiTask(taskId, "feishu", { target: String(profile) }, async () => {
      await syncFeishuBitable({
        profile: profile === "shop" ? "shop" : "creator",
        keepRows: effectiveKeepRows,
      });
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
