import { NextRequest, NextResponse } from "next/server";
import { getSeedanceTask, resolveSeedanceApiKey } from "@/lib/volcengineSeedance";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const apiKey = resolveSeedanceApiKey();
    const task = await getSeedanceTask(taskId, apiKey);
    return NextResponse.json({ task });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "查询 Seedance 任务失败" }, { status: 400 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const apiKey = resolveSeedanceApiKey();
    const task = await getSeedanceTask(taskId, apiKey);
    return NextResponse.json({ task });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "查询 Seedance 任务失败" }, { status: 400 });
  }
}
