import { NextRequest, NextResponse } from "next/server";
import { spawnTask, isTaskRunning } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { profile = "creator", keepRows } = body;

    require("dotenv").config();
    process.env.FEISHU_BITABLE_PROFILE = profile;

    const taskId = `feishu-sync-${Date.now()}`;
    const args = ["scripts/feishu/index.js", "sync-data-xlsx"];
    if (keepRows !== undefined) args.push("--keep-rows", String(keepRows));

    spawnTask(taskId, "node", args);

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
