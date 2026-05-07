import { NextRequest, NextResponse } from "next/server";
import { spawnTask, canStartTask, generateTaskIdWithTime } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    if (!canStartTask("login")) {
      return NextResponse.json(
        { error: "已有登录任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    require("dotenv").config();

    const body = await request.json().catch(() => ({} as any));
    const email = String(body?.email || "").trim();
    if (!email) {
      return NextResponse.json({ error: "缺少 email" }, { status: 400 });
    }

    const taskId = generateTaskIdWithTime("shop-login-one");
    spawnTask(taskId, "node", ["scripts/run.js", "shop:login", email], { namespace: "login" });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
