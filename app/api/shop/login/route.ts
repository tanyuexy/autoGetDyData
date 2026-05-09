import { NextRequest, NextResponse } from "next/server";
import { enqueueTask, canStartTask, generateTaskIdWithTime } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(_request: NextRequest) {
  try {
    if (!(await canStartTask("login"))) {
      return NextResponse.json(
        { error: "已有登录任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    require("dotenv").config();

    const taskId = generateTaskIdWithTime("shop-login");
    await enqueueTask(taskId, "node", ["scripts/run.js", "shop:login"], { namespace: "login" });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
