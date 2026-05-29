import {
  normalizeWorkTitleKey,
  sumShopSalesEntries,
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

export type CreatorInsightsCreationTypePoint = {
  name: string;
  itemCount: number;
  worksWithSalesCount: number;
  playCount: number;
  interactionCount: number;
  cumulativeSalesAmount: number;
  periodSalesAmount: number;
  periodSalesWorkCount: number;
  avgPeriodSalesAmount: number;
  avgCompletion: number | null;
  completionCount: number;
};

export type CreatorInsightsSummaryMetrics = {
  count: number;
  worksWithSalesCount: number;
  playCount: number;
  interactions: number;
  avgCompletion: number;
  cumulativeSalesAmount: number;
  periodSalesAmount: number;
  periodSalesWorkCount: number;
  avgPeriodSalesAmount: number;
};

export type CreatorInsightsSummaryResult = {
  metrics: CreatorInsightsSummaryMetrics;
  creationTypeBreakdown: CreatorInsightsCreationTypePoint[];
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
  creationType: string;
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

function creationTypeKey(item: CreatorInsightLeanRow): string {
  return item.creationType || "未填写";
}

function countPeriodSalesWorks(
  items: CreatorInsightLeanRow[],
  range: { start: string; end: string } | null
): number {
  const seen = new Set<string>();
  let count = 0;
  for (const item of items) {
    const key = normalizeWorkTitleKey(item.title);
    if (!key || seen.has(key)) continue;
    if (sumShopSalesEntries(item.shopSalesEntries, range) <= 0) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

function buildCreationTypeBreakdown(
  tableItems: CreatorInsightLeanRow[],
  salesScopeItems: CreatorInsightLeanRow[],
  salesDateRange: { start: string; end: string } | null
): CreatorInsightsCreationTypePoint[] {
  const typeNames = new Set<string>();
  for (const item of tableItems) typeNames.add(creationTypeKey(item));
  for (const item of salesScopeItems) typeNames.add(creationTypeKey(item));

  const points: CreatorInsightsCreationTypePoint[] = [];
  for (const name of typeNames) {
    const tableSubset = tableItems.filter((item) => creationTypeKey(item) === name);
    const salesSubset = salesScopeItems.filter((item) => creationTypeKey(item) === name);
    const withCompletion = tableSubset.filter((item) => item.completionRate != null);
    const periodSalesAmount = sumShopSalesEntriesForItems(salesSubset, salesDateRange);
    const periodSalesWorkCount = countPeriodSalesWorks(salesSubset, salesDateRange);
    points.push({
      name,
      itemCount: tableSubset.length,
      worksWithSalesCount: countPeriodSalesWorks(tableSubset, salesDateRange),
      playCount: tableSubset.reduce((sum, item) => sum + (item.playCount || 0), 0),
      interactionCount: tableSubset.reduce((sum, item) => sum + interactionCount(item), 0),
      cumulativeSalesAmount: sumShopSalesEntriesForItems(tableSubset, salesDateRange),
      periodSalesAmount,
      periodSalesWorkCount,
      avgPeriodSalesAmount: periodSalesAmount / Math.max(periodSalesWorkCount, 1),
      avgCompletion:
        withCompletion.length > 0
          ? withCompletion.reduce((sum, item) => sum + (item.completionRate || 0), 0) /
            withCompletion.length
          : null,
      completionCount: withCompletion.length,
    });
  }

  return points.sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name, "zh-CN"));
}

export function computeCreatorInsightsSummary(input: {
  tableItems: CreatorInsightLeanRow[];
  salesScopeItems: CreatorInsightLeanRow[];
  salesDateRange: { start: string; end: string } | null;
  chartDateRange: { start: string; end: string } | null;
}): CreatorInsightsSummaryResult {
  const { tableItems, salesScopeItems, salesDateRange, chartDateRange } = input;

  const count = tableItems.length;
  const worksWithSalesCount = countPeriodSalesWorks(tableItems, salesDateRange);
  const playCount = tableItems.reduce((sum, item) => sum + (item.playCount || 0), 0);
  const cumulativeSalesAmount = sumShopSalesEntriesForItems(tableItems, salesDateRange);
  const periodSalesAmount = sumShopSalesEntriesForItems(salesScopeItems, salesDateRange);
  const periodSalesWorkCount = countPeriodSalesWorks(salesScopeItems, salesDateRange);
  const avgPeriodSalesAmount = periodSalesAmount / Math.max(periodSalesWorkCount, 1);
  const interactions = tableItems.reduce((sum, item) => sum + interactionCount(item), 0);
  const withCompletion = tableItems.filter((item) => item.completionRate != null);
  const avgCompletion =
    withCompletion.reduce((sum, item) => sum + (item.completionRate || 0), 0) /
    Math.max(withCompletion.length, 1);

  return {
    metrics: {
      count,
      worksWithSalesCount,
      playCount,
      interactions,
      avgCompletion,
      cumulativeSalesAmount,
      periodSalesAmount,
      periodSalesWorkCount,
      avgPeriodSalesAmount,
    },
    creationTypeBreakdown: buildCreationTypeBreakdown(tableItems, salesScopeItems, salesDateRange),
    shopRanking: groupBy(tableItems, (item) => item.shopName).sort((a, b) => b.playCount - a.playCount),
    typeRanking: groupBy(tableItems, (item) => item.workType).sort((a, b) => b.itemCount - a.itemCount),
    dailyTrend: buildDailySeries(tableItems, chartDateRange),
    shopSalesDailyTrend: buildShopSalesDailySeries(salesScopeItems, chartDateRange),
  };
}
