import { NextRequest, NextResponse } from "next/server";
import { spawnTask, generateTaskIdWithTime } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { profiles = "creator,shop" } = body;

    require("dotenv").config();

    const taskId = generateTaskIdWithTime("feishu-backup");
    spawnTask(taskId, "node", [
      "scripts/run.js",
      "feishu:backup",
      "--profiles",
      profiles,
    ], { namespace: "feishu" });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
