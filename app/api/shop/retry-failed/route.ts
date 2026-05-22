import dotenv from "dotenv";
import { NextRequest, NextResponse } from "next/server";
import { enqueueTask, canStartTask, generateTaskIdWithTime } from "@/lib/taskManager";
import crypto from "crypto";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    if (!(await canStartTask("shop-export"))) {
      return NextResponse.json(
        { error: "已有抖店导出任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    dotenv.config();

    const body = await request.json().catch(() => ({} as any));
    const runId = String(body?.runId || "").trim();
    const suffix = crypto.randomBytes(3).toString("hex");
    const taskId = `${generateTaskIdWithTime("shop-retry-failed")}-${suffix}`;

    await enqueueTask(taskId, "node", ["scripts/run.js", "shop:retry-failed"], {
      namespace: "shop-export",
      env: {
        SHOP_RETRY_RUN_ID: runId || undefined,
      },
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
