import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { generateTaskIdWithTime, canStartTask } from "@/lib/tasks/taskManager";
import { startApiTask } from "@/lib/tasks/apiTaskRunner";
import { generateFeishuTaskAiContent } from "@/lib/feishu/service";
import type { LlmProvider } from "@/lib/llm";

export const maxDuration = 0;

function isValidProvider(value: unknown): value is LlmProvider {
  return value === "siliconflow" || value === "deepseek" || value === "minimax";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const provider = isValidProvider(body?.provider) ? body.provider : "minimax";

    if (!(await canStartTask("creator-publish"))) {
      return NextResponse.json(
        { error: "已有发布任务正在执行，请等待完成后再生成AI正文" },
        { status: 409 }
      );
    }

    const suffix = crypto.randomBytes(3).toString("hex");
    const taskId = `${generateTaskIdWithTime("feishu-ai-content")}-${suffix}`;

    startApiTask(taskId, "creator-publish", { target: "feishu-ai-content" }, async ({ log, isCancelled }) => {
      await generateFeishuTaskAiContent({
        provider,
        logger: (...args) => log(...args),
        isCancelled,
      });
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
