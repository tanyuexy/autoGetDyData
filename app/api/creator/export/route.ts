import { NextRequest, NextResponse } from "next/server";
import { spawnTask, isTaskRunning } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    if (isTaskRunning()) {
      return NextResponse.json(
        { error: "已有任务正在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { accounts = [], syncFeishu = false } = body;

    const taskId = `creator-export-${Date.now()}`;

    // Read dotenv first so the child process has env vars
    require("dotenv").config();

    const command = syncFeishu ? "export:feishu" : "export";
    const args = ["scripts/douyin-creator/index.js", command, ...accounts.filter(Boolean)];

    spawnTask(taskId, "node", args);

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
