import { NextResponse } from "next/server";
import { getCreatorInsightsFacets } from "@/lib/creator/insights";

export const maxDuration = 0;

export async function GET() {
  try {
    const result = await getCreatorInsightsFacets();
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "加载筛选项失败" }, { status: 500 });
  }
}
