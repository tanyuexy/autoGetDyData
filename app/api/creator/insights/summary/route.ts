import { NextRequest, NextResponse } from "next/server";
import { getCreatorInsightsSummary } from "@/lib/creator/insights";
import { parseCreatorInsightsQuery } from "@/lib/creator/insights-query";

export const maxDuration = 0;

export async function GET(request: NextRequest) {
  try {
    const parsed = parseCreatorInsightsQuery(request.nextUrl.searchParams);
    const result = await getCreatorInsightsSummary({
      shop: parsed.shop,
      workType: parsed.workType,
      creationType: parsed.creationType,
      status: parsed.status,
      teams: parsed.teams,
      keyword: parsed.keyword,
      dateStart: parsed.dateStart,
      dateEnd: parsed.dateEnd,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "加载抖创汇总失败" }, { status: 500 });
  }
}
