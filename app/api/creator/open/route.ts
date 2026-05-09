import { NextRequest, NextResponse } from "next/server";
import { enqueueTask, generateTaskIdWithTime } from "@/lib/taskManager";
import crypto from "crypto";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const accountName = String(body?.accountName || "").trim();
    if (!accountName) {
      return NextResponse.json({ error: "缺少 accountName" }, { status: 400 });
    }

    const suffix = crypto.randomBytes(3).toString("hex");
    const taskId = `${generateTaskIdWithTime(`creator-open-${accountName}`)}-${suffix}`;
    await enqueueTask(taskId, "node", ["scripts/run.js", "creator:open", accountName], {
      namespace: "creator-open",
      env: { HEADLESS: "false" },
      interactive: true,
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
