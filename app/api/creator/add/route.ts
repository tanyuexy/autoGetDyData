import { NextRequest, NextResponse } from "next/server";
import { spawnTask, isTaskRunning } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { accountName } = body;

    require("dotenv").config();

    const taskId = `creator-add-${Date.now()}`;
    const args = ["scripts/douyin-creator/index.js", "add"];
    if (accountName) args.push(accountName);

    spawnTask(taskId, "node", args);

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
