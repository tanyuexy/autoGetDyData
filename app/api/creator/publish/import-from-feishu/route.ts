import { NextRequest, NextResponse } from "next/server";
import { spawnTask, generateTaskIdWithTime, canStartTask } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(_request: NextRequest) {
  try {
    if (!canStartTask("creator-publish")) {
      return NextResponse.json(
        { error: "已有发布任务正在执行，请等待完成后再导入" },
        { status: 409 }
      );
    }

    require("dotenv").config();

    const taskId = generateTaskIdWithTime("feishu-import");
    spawnTask(taskId, "node", [
      "scripts/run.js",
      "feishu:import-publish-tasks",
    ], { namespace: "creator-publish" });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
