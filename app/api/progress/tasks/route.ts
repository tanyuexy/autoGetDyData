import { NextResponse } from "next/server";
import { getRunningTaskList } from "@/lib/taskManager";
import { getConfig } from "@/lib/configService";
import { normalizePublishMaxConcurrent } from "@/lib/publishConcurrency";

/** 前台用于判断按钮「namespace 已满」是否与后端一致（发布并发来自配置页） */
const DEFAULT_NAMESPACE_UI_LIMITS: Record<string, number> = {
  "creator-export": 1,
  "shop-export": 1,
  login: 1,
  "creator-publish": 3,
  system: 1,
};

export async function GET() {
  const running = await getRunningTaskList();
  const cfg = await getConfig().catch(() => null);
  const publishMax = normalizePublishMaxConcurrent(cfg?.creatorPublish?.publishMaxConcurrent);
  return NextResponse.json({
    running,
    namespaceLimits: {
      ...DEFAULT_NAMESPACE_UI_LIMITS,
      "creator-publish": publishMax,
    },
  });
}
