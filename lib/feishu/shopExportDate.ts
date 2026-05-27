import { readBitable } from "@/lib/feishu/core/readBitable";

export function formatDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateSlashYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

export function parseFeishuShopDateValue(raw: unknown): Date | null {
  if (raw === undefined || raw === null) return null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw > 1e15 ? raw / 1000 : raw;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  const text = String(raw).trim();
  if (!text) return null;

  const match = text.match(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  const date = new Date(text.replace(/\//g, "-"));
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function readShopMaxDateFromFeishu(): Promise<Date | null> {
  const { records } = await readBitable("shop", { recordsOnly: true });

  let maxDate: Date | null = null;
  for (const record of records) {
    const raw = record?.fields?.["日期"];
    const date = parseFeishuShopDateValue(raw);
    if (date && (!maxDate || date > maxDate)) {
      maxDate = date;
    }
  }

  return maxDate;
}

export function calcDaysToExportFromMaxDate(maxDate: Date | null): number {
  if (!maxDate) {
    console.log("飞书表中未找到有效日期，默认导出最近 1 天");
    return 1;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  if (maxDate >= yesterday) {
    console.log(
      `飞书表最后日期: ${formatDateSlashYmd(maxDate)}，已覆盖到最新可导出的昨日数据，` +
        `本次仍刷新导出昨天 ${formatDateSlashYmd(yesterday)} 1 天数据`
    );
    return 1;
  }

  const startDate = new Date(maxDate);
  startDate.setDate(startDate.getDate() + 1);

  const diffMs = yesterday.getTime() - startDate.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;

  console.log(
    `飞书表最后日期: ${formatDateSlashYmd(maxDate)}，从 ${formatDateSlashYmd(startDate)} 开始导出，` +
      `昨天为 ${formatDateSlashYmd(yesterday)}，共需导出 ${days} 天数据`
  );
  return days;
}

export async function calcShopDaysToExport(): Promise<number> {
  const maxDate = await readShopMaxDateFromFeishu();
  return calcDaysToExportFromMaxDate(maxDate);
}

export function buildShopExportDateRange(daysToExport: number): {
  startDate: string;
  endDate: string;
} {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  end.setHours(0, 0, 0, 0);

  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(0, daysToExport - 1));

  return {
    startDate: formatDateYmd(start),
    endDate: formatDateYmd(end),
  };
}

export function parseDateYmd(value: unknown): Date | null {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildDateRangeStrings(start: Date, end: Date): string[] {
  const result: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    result.push(formatDateYmd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export function parseExportDateRange(body: {
  startDate?: unknown;
  endDate?: unknown;
}): string[] {
  const start = parseDateYmd(body?.startDate);
  const end = parseDateYmd(body?.endDate);
  if (!start || !end) return [];
  if (start.getTime() > end.getTime()) return [];
  return buildDateRangeStrings(start, end);
}
