import {
  normalizeWorkTitleKey,
  sumShopSalesEntriesForItems,
  type ShopSalesEntry,
} from "@/lib/creator/insights-types";

export type CreatorInsightsGroupPoint = {
  name: string;
  playCount: number;
  salesAmount: number;
  interactionCount: number;
  itemCount: number;
};

export type CreatorInsightsSummaryMetrics = {
  count: number;
  playCount: number;
  interactions: number;
  avgCompletion: number;
  cumulativeSalesAmount: number;
  periodSalesAmount: number;
};

export type CreatorInsightsSummaryResult = {
  metrics: CreatorInsightsSummaryMetrics;
  shopRanking: CreatorInsightsGroupPoint[];
  typeRanking: CreatorInsightsGroupPoint[];
  dailyTrend: CreatorInsightsGroupPoint[];
  shopSalesDailyTrend: CreatorInsightsGroupPoint[];
};

export type CreatorInsightLeanRow = {
  title: string;
  shopName: string;
  publishDate: string | null;
  workType: string;
  playCount: number;
  completionRate: number | null;
  likeCount: number;
  shareCount: number;
  commentCount: number;
  favoriteCount: number;
  salesAmount: number;
  shopSalesEntries: ShopSalesEntry[];
};

function interactionCount(item: CreatorInsightLeanRow) {
  return item.likeCount + item.shareCount + item.commentCount + item.favoriteCount;
}

function emptyGroupPoint(name: string): CreatorInsightsGroupPoint {
  return {
    name,
    playCount: 0,
    salesAmount: 0,
    interactionCount: 0,
    itemCount: 0,
  };
}

function groupBy(
  items: CreatorInsightLeanRow[],
  key: (item: CreatorInsightLeanRow) => string
): CreatorInsightsGroupPoint[] {
  const map = new Map<string, CreatorInsightsGroupPoint>();
  for (const item of items) {
    const name = key(item) || "未填写";
    const current = map.get(name) || emptyGroupPoint(name);
    current.playCount += item.playCount || 0;
    current.salesAmount += item.salesAmount || 0;
    current.interactionCount += interactionCount(item);
    current.itemCount += 1;
    map.set(name, current);
  }
  return [...map.values()];
}

function buildDailySeries(
  items: CreatorInsightLeanRow[],
  range: { start: string; end: string } | null
): CreatorInsightsGroupPoint[] {
  const grouped = new Map<string, CreatorInsightsGroupPoint>();
  for (const item of items) {
    if (!item.publishDate) continue;
    const name = item.publishDate;
    const current = grouped.get(name) || emptyGroupPoint(name);
    current.playCount += item.playCount || 0;
    current.salesAmount += item.salesAmount || 0;
    current.interactionCount += interactionCount(item);
    current.itemCount += 1;
    grouped.set(name, current);
  }

  if (!range) {
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  const days: CreatorInsightsGroupPoint[] = [];
  for (let current = range.start; current <= range.end; ) {
    days.push(grouped.get(current) || emptyGroupPoint(current));
    const year = Number(current.slice(0, 4));
    const month = Number(current.slice(5, 7));
    const day = Number(current.slice(8, 10));
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    current = next.toISOString().slice(0, 10);
  }
  return days;
}

function buildShopSalesDailySeries(
  items: CreatorInsightLeanRow[],
  range: { start: string; end: string } | null
): CreatorInsightsGroupPoint[] {
  const grouped = new Map<string, CreatorInsightsGroupPoint>();
  const seenTitles = new Set<string>();
  for (const item of items) {
    const titleKey = normalizeWorkTitleKey(item.title);
    if (!titleKey || seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    for (const entry of item.shopSalesEntries || []) {
      if (!entry.salesDate) continue;
      if (range && (entry.salesDate < range.start || entry.salesDate > range.end)) continue;
      const current = grouped.get(entry.salesDate) || emptyGroupPoint(entry.salesDate);
      current.salesAmount += entry.amount || 0;
      grouped.set(entry.salesDate, current);
    }
  }

  if (!range) {
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  const days: CreatorInsightsGroupPoint[] = [];
  for (let current = range.start; current <= range.end; ) {
    days.push(grouped.get(current) || emptyGroupPoint(current));
    const year = Number(current.slice(0, 4));
    const month = Number(current.slice(5, 7));
    const day = Number(current.slice(8, 10));
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    current = next.toISOString().slice(0, 10);
  }
  return days;
}

export function computeCreatorInsightsSummary(input: {
  tableItems: CreatorInsightLeanRow[];
  salesScopeItems: CreatorInsightLeanRow[];
  salesDateRange: { start: string; end: string } | null;
  chartDateRange: { start: string; end: string } | null;
}): CreatorInsightsSummaryResult {
  const { tableItems, salesScopeItems, salesDateRange, chartDateRange } = input;

  const count = tableItems.length;
  const playCount = tableItems.reduce((sum, item) => sum + (item.playCount || 0), 0);
  const cumulativeSalesAmount = sumShopSalesEntriesForItems(tableItems, salesDateRange);
  const periodSalesAmount = sumShopSalesEntriesForItems(salesScopeItems, salesDateRange);
  const interactions = tableItems.reduce((sum, item) => sum + interactionCount(item), 0);
  const withCompletion = tableItems.filter((item) => item.completionRate != null);
  const avgCompletion =
    withCompletion.reduce((sum, item) => sum + (item.completionRate || 0), 0) /
    Math.max(withCompletion.length, 1);

  return {
    metrics: {
      count,
      playCount,
      interactions,
      avgCompletion,
      cumulativeSalesAmount,
      periodSalesAmount,
    },
    shopRanking: groupBy(tableItems, (item) => item.shopName).sort((a, b) => b.playCount - a.playCount),
    typeRanking: groupBy(tableItems, (item) => item.workType).sort((a, b) => b.itemCount - a.itemCount),
    dailyTrend: buildDailySeries(tableItems, chartDateRange),
    shopSalesDailyTrend: buildShopSalesDailySeries(salesScopeItems, chartDateRange),
  };
}
