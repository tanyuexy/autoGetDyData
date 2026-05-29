export type ShopSalesEntry = {
  salesDate: string;
  amount: number;
};

export type CreatorInsightItem = {
  id: string;
  recordId: string;
  title: string;
  shopName: string;
  publishTime: string | null;
  publishDate: string | null;
  workType: string;
  /** 飞书「类型」：实拍 / AI创作 等（链接字段解析后的选项名） */
  creationType: string;
  reviewStatus: string;
  playCount: number;
  completionRate: number | null;
  fiveSecondCompletionRate: number | null;
  coverClickRate: number | null;
  twoSecondBounceRate: number | null;
  avgPlayDuration: number | null;
  likeCount: number;
  shareCount: number;
  commentCount: number;
  favoriteCount: number;
  profileVisitCount: number;
  followerCount: number;
  /** 抖创表「销售额」：作品发布以来的累计成交 */
  salesAmount: number;
  /** 抖店表按成交日期拆分的销售额明细 */
  shopSalesEntries: ShopSalesEntry[];
  productId: string;
  relatedProduct: string;
  videoLink: string;
  productionTeam: string;
  rawFields: Record<string, unknown>;
  importedAt: string;
  updatedAt: string;
};

/** 与 insights.buildWorkMatchKey 一致：去空白后的作品名 */
export function normalizeWorkTitleKey(title: string): string {
  return String(title || "").replace(/\s+/g, "").trim();
}

type ShopSalesItemRef = { title: string; shopSalesEntries?: ShopSalesEntry[] };

/** 按作品名去重后汇总，避免同名作品多行重复计入成交 */
export function sumShopSalesEntriesForItems(
  items: ShopSalesItemRef[],
  range?: { start: string; end: string } | null
): number {
  const seen = new Set<string>();
  let sum = 0;
  for (const item of items) {
    const key = normalizeWorkTitleKey(item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sum += sumShopSalesEntries(item.shopSalesEntries, range);
  }
  return sum;
}

export function sumShopSalesEntries(
  entries: ShopSalesEntry[] | undefined,
  range?: { start: string; end: string } | null
): number {
  if (!entries?.length) return 0;
  if (!range?.start || !range?.end) {
    return entries.reduce((sum, entry) => sum + (entry.amount || 0), 0);
  }
  return entries.reduce((sum, entry) => {
    if (!entry.salesDate) return sum;
    if (entry.salesDate < range.start || entry.salesDate > range.end) return sum;
    return sum + (entry.amount || 0);
  }, 0);
}
