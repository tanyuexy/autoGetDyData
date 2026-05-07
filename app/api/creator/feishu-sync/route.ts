import { NextRequest, NextResponse } from "next/server";
import { spawnTask, canStartTask, generateTaskIdWithTime } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    if (!canStartTask("creator-export")) {
      return NextResponse.json(
        { error: "已有抖创同步任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    require("dotenv").config();

    const body = await request.json().catch(() => ({} as any));
    const accounts = Array.isArray(body?.accounts)
      ? body.accounts.map((s: any) => String(s || "").trim()).filter(Boolean)
      : [];

    const taskId = generateTaskIdWithTime("creator-feishu-sync");
    const args = ["scripts/run.js", "feishu:sync-creator"];

    spawnTask(taskId, "node", args, { namespace: "creator-export" });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
