import { NextRequest, NextResponse } from "next/server";
import { spawnTask, isTaskRunning } from "@/lib/taskManager";

export const maxDuration = 0;

type LoginMode = "email_qr" | "local_manual";

export async function POST(request: NextRequest) {
  try {
    if (isTaskRunning()) {
      return NextResponse.json(
        { error: "已有任务正在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    require("dotenv").config();

    const body = await request.json().catch(() => ({} as any));
    const accountName = String(body?.accountName || "").trim();
    const mode = String(body?.mode || "email_qr") as LoginMode;

    if (!accountName) {
      return NextResponse.json({ error: "缺少 accountName" }, { status: 400 });
    }

    const headless = mode === "local_manual" ? "false" : "true";

    const taskId = `creator-login-${Date.now()}`;
    spawnTask(taskId, "node", ["scripts/run.js", "creator:login", accountName], {
      env: { HEADLESS: headless },
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
