import { NextRequest, NextResponse } from "next/server";
import { spawnTask, generateTaskIdWithTime } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const accountName = String(body?.accountName || "").trim();
    if (!accountName) {
      return NextResponse.json({ error: "缺少 accountName" }, { status: 400 });
    }

    const taskId = generateTaskIdWithTime(`creator-open-${accountName}`);
    spawnTask(taskId, "node", ["scripts/douyin-creator/open.js", accountName], {
      namespace: "system",
      env: { HEADLESS: "false" },
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
