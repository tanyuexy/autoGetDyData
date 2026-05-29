import { NextRequest, NextResponse } from "next/server";
import { listCreatorInsightsPage, syncCreatorInsightsFromFeishu } from "@/lib/creator/insights";
import { parseCreatorInsightsQuery } from "@/lib/creator/insights-query";

export const maxDuration = 0;

export async function GET(request: NextRequest) {
  try {
    const params = parseCreatorInsightsQuery(request.nextUrl.searchParams);
    const result = await listCreatorInsightsPage(params);
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
