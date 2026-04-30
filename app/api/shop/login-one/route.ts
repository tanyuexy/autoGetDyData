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

    require("dotenv").config();

    const body = await request.json().catch(() => ({} as any));
    const email = String(body?.email || "").trim();
    if (!email) {
      return NextResponse.json({ error: "缺少 email" }, { status: 400 });
    }

    const taskId = `shop-login-one-${Date.now()}`;
    // 传入邮箱即可：scripts/douyin-shop/index.js 会自动使用默认密码
    spawnTask(taskId, "node", ["scripts/run.js", "shop:login", email]);

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
