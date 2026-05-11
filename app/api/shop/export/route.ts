import { NextRequest, NextResponse } from "next/server";
import { enqueueTask, canStartTask, generateTaskIdWithTime } from "@/lib/taskManager";

export const maxDuration = 0;

function parseShopNames(body: any) {
  return Array.isArray(body?.shopNames)
    ? body.shopNames.map((s: any) => String(s || "").trim()).filter(Boolean)
    : [];
}

function parseDateYmd(value: any) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateYmd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildDateRangeStrings(start: Date, end: Date) {
  const result: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    result.push(formatDateYmd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function parseExportDateRange(body: any) {
  const start = parseDateYmd(body?.startDate);
  const end = parseDateYmd(body?.endDate);
  if (!start || !end) return [];
  if (start.getTime() > end.getTime()) return [];
  return buildDateRangeStrings(start, end);
}

export async function GET() {
  try {
    require("dotenv").config();
    const { calcDaysToExport } = require("@/scripts/douyin-shop/lib/merge-shop-exports");
    let daysToExport = 1;
    try {
      daysToExport = await calcDaysToExport();
    } catch {}

    const end = new Date();
    end.setDate(end.getDate() - 1);
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - Math.max(0, daysToExport - 1));

    return NextResponse.json({
      startDate: formatDateYmd(start),
      endDate: formatDateYmd(end),
      daysToExport,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!(await canStartTask("shop-export"))) {
      return NextResponse.json(
        { error: "已有抖店导出任务在运行，请等待完成后再执行" },
        { status: 409 }
      );
    }

    require("dotenv").config();

    const body = await request.json().catch(() => ({} as any));
    const shopNames = parseShopNames(body);
    const targetDates = parseExportDateRange(body);

    const taskId = generateTaskIdWithTime("shop-export");
    await enqueueTask(taskId, "node", ["scripts/run.js", "shop:export"], {
      namespace: "shop-export",
      env: {
        SHOP_SELECTED_NAMES: shopNames.join(","),
        SHOP_EXPORT_TARGET_DATES: targetDates.join(","),
      },
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
