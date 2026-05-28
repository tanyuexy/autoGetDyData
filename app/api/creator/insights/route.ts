import { NextRequest, NextResponse } from "next/server";
import {
  listCreatorInsights,
  syncCreatorInsightsFromFeishu,
} from "@/lib/creator/insights";

export const maxDuration = 0;

export async function GET(request: NextRequest) {
  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") || 500);
    const result = await listCreatorInsights({ limit });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "加载抖创数据失败" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const result = await syncCreatorInsightsFromFeishu();
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "同步飞书抖创数据失败" }, { status: 500 });
  }
}
