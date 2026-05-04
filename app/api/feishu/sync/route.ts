import { NextRequest, NextResponse } from "next/server";
import { spawnTask, generateTaskIdWithTime } from "@/lib/taskManager";

export const maxDuration = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { profile = "creator", keepRows } = body;

    require("dotenv").config();
    process.env.FEISHU_BITABLE_PROFILE = profile;

    let defaultKeepRows = 0;
    try {
      const { getConfig } = require("@/lib/configService");
      const cfg = getConfig();
      defaultKeepRows = Number(cfg?.feishu?.shop?.keepRows ?? 0) || 0;
    } catch { }

    const taskId = generateTaskIdWithTime("feishu-sync");
    const args = [
      "scripts/run.js",
      profile === "shop" ? "feishu:sync-shop" : "feishu:sync-creator",
    ];

    const effectiveKeepRows =
      keepRows !== undefined ? Number(keepRows) : profile === "shop" ? defaultKeepRows : 0;

    if (effectiveKeepRows !== undefined && Number.isFinite(effectiveKeepRows) && effectiveKeepRows > 0) {
      args.push("--keep-rows", String(Math.floor(effectiveKeepRows)));
    }

    spawnTask(taskId, "node", args, { namespace: "system" });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
