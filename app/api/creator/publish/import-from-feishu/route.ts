import { NextRequest, NextResponse } from "next/server";
import { generateTaskIdWithTime, canStartTask } from "@/lib/taskManager";
import { startApiTask } from "@/lib/apiTaskRunner";
import { importPublishTasksFromFeishu } from "@/lib/feishu/service";
import crypto from "crypto";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const autoStart = body?.autoStart === true;
    if (!(await canStartTask("creator-publish"))) {
      return NextResponse.json(
        { error: "已有发布任务正在执行，请等待完成后再导入" },
        { status: 409 }
      );
    }

    const suffix = crypto.randomBytes(3).toString("hex");
    const taskId = `${generateTaskIdWithTime("feishu-import")}-${suffix}`;
    startApiTask(taskId, "creator-publish", { target: "feishu-import" }, async ({ log }) => {
      await importPublishTasksFromFeishu({
        autoStart,
        allowCreate: true,
        logger: (...args) => log(...args),
      });
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
