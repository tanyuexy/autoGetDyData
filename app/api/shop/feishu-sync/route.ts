import { NextRequest, NextResponse } from "next/server";
import { spawnTask, isTaskRunning } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(_request: NextRequest) {
  try {
    if (isTaskRunning()) {
      return NextResponse.json(
        { error: "已有任务正在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    require("dotenv").config();

    const taskId = `shop-feishu-sync-${Date.now()}`;
    spawnTask(taskId, "node", [
      "scripts/douyin-shop/index.js",
      "feishu-sync",
    ]);

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
