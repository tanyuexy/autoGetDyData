import { NextRequest, NextResponse } from "next/server";
import { spawnTask, canStartTask } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    if (!canStartTask("creator-export")) {
      return NextResponse.json(
        { error: "已有抖创导出任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    require("dotenv").config();

    const body = await request.json().catch(() => ({} as any));
    const accounts = Array.isArray(body?.accounts)
      ? body.accounts.map((s: any) => String(s || "").trim()).filter(Boolean)
      : [];

    const taskId = `creator-export-${Date.now()}`;
    const args = ["scripts/run.js", "creator:export", ...accounts];

    spawnTask(taskId, "node", args, { namespace: "creator-export" });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
