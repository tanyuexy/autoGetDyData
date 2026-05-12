import { NextRequest, NextResponse } from "next/server";
import { enqueueTask, generateTaskIdWithTime } from "@/lib/taskManager";
import crypto from "crypto";

export const maxDuration = 0;

function normalizeTargetUrl(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return "";

  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "creator.douyin.com") {
    throw new Error("targetUrl 只允许 https://creator.douyin.com 下的页面");
  }
  return url.toString();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const accountName = String(body?.accountName || "").trim();
    if (!accountName) {
      return NextResponse.json({ error: "缺少 accountName" }, { status: 400 });
    }
    const targetUrl = normalizeTargetUrl(body?.targetUrl);

    const suffix = crypto.randomBytes(3).toString("hex");
    const taskId = `${generateTaskIdWithTime(`creator-open-${accountName}`)}-${suffix}`;
    await enqueueTask(taskId, "node", ["scripts/run.js", "creator:open", accountName, targetUrl].filter(Boolean), {
      namespace: "creator-open",
      env: { HEADLESS: "false" },
      interactive: true,
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
