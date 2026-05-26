import { NextRequest, NextResponse } from "next/server";
import { enqueueTask, generateTaskIdWithTime } from "@/lib/taskManager";
import crypto from "crypto";

export const maxDuration = 0;

function normalizeTargetUrl(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return "";

  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith("jinritemai.com")) {
    throw new Error("targetUrl 只允许 https://*.jinritemai.com 下的页面");
  }
  return url.toString();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const email = String(body?.email || "").trim();
    if (!email) {
      return NextResponse.json({ error: "缺少 email" }, { status: 400 });
    }
    const targetUrl = normalizeTargetUrl(body?.targetUrl);

    const suffix = crypto.randomBytes(3).toString("hex");
    const taskId = `${generateTaskIdWithTime(`shop-open-${email}`)}-${suffix}`;
    await enqueueTask(
      taskId,
      "node",
      ["scripts/run.js", "shop:open", email, targetUrl].filter(Boolean),
      {
        namespace: "shop-open",
        env: { HEADLESS: "false" },
        interactive: true,
      }
    );

    return NextResponse.json({ taskId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "打开抖店页面失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
