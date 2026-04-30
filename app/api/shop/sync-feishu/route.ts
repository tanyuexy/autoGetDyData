import { NextRequest, NextResponse } from "next/server";
import { spawnTask, isTaskRunning } from "@/lib/taskManager";

export const maxDuration = 0;

function parseShopNames(body: any) {
  return Array.isArray(body?.shopNames)
    ? body.shopNames.map((s: any) => String(s || "").trim()).filter(Boolean)
    : [];
}

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
    const shopNames = parseShopNames(body);

    const taskId = `shop-sync-feishu-${Date.now()}`;
    spawnTask(taskId, "node", ["scripts/run.js", "shop:sync-feishu"], {
      env: {
        SHOP_SELECTED_NAMES: shopNames.join(","),
      },
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
