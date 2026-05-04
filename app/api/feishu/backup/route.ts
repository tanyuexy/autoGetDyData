import { NextRequest, NextResponse } from "next/server";
import { spawnTask } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { profiles = "creator,shop" } = body;

    require("dotenv").config();

    const taskId = `feishu-backup-${Date.now()}`;
    spawnTask(taskId, "node", [
      "scripts/run.js",
      "feishu:backup",
      "--profiles",
      profiles,
    ], { namespace: "system" });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
