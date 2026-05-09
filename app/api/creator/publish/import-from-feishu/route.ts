import { NextRequest, NextResponse } from "next/server";
import { enqueueTask, generateTaskIdWithTime, canStartTask } from "@/lib/taskManager";
import crypto from "crypto";

export const maxDuration = 0;

export async function POST(_request: NextRequest) {
  try {
    if (!(await canStartTask("creator-publish"))) {
      return NextResponse.json(
        { error: "已有发布任务正在执行，请等待完成后再导入" },
        { status: 409 }
      );
    }

    require("dotenv").config();

    const suffix = crypto.randomBytes(3).toString("hex");
    const taskId = `${generateTaskIdWithTime("feishu-import")}-${suffix}`;
    await enqueueTask(taskId, "node", [
      "scripts/run.js",
      "feishu:import-publish-tasks",
    ], {
      namespace: "creator-publish",
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
