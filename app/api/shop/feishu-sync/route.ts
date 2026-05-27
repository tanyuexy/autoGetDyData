import { NextRequest, NextResponse } from "next/server";
import { canStartTask, generateTaskIdWithTime } from "@/lib/tasks/taskManager";
import { startApiTask } from "@/lib/tasks/apiTaskRunner";
import { syncFeishuBitable } from "@/lib/feishu/service";

export const maxDuration = 0;

function parseShopNames(body: any) {
  return Array.isArray(body?.shopNames)
    ? body.shopNames.map((s: any) => String(s || "").trim()).filter(Boolean)
    : [];
}

export async function POST(request: NextRequest) {
  try {
    if (!(await canStartTask("shop-export"))) {
      return NextResponse.json(
        { error: "已有抖店同步任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({} as any));
    const shopNames = parseShopNames(body);

    const taskId = generateTaskIdWithTime("shop-feishu-sync");
    startApiTask(taskId, "shop-export", { target: shopNames.join(",") || "shop" }, async () => {
      await syncFeishuBitable({ profile: "shop" });
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
