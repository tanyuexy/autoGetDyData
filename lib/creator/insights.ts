import crypto from "node:crypto";
import { getDb } from "@/lib/db/mongo";
import { getConfig } from "@/lib/configService";
import { readBitable } from "@/lib/feishu/core/readBitable";
import { getValidAccessToken } from "@/lib/feishu/core/oauth";
import { listBitableFields } from "@/lib/feishu/core/bitable";
import type { CreatorInsightItem, ShopSalesEntry } from "@/lib/creator/insights-types";
import {
  buildCreatorInsightsMongoFilter,
  type CreatorInsightsQueryParams,
} from "@/lib/creator/insights-query";
import {
  computeCreatorInsightsSummary,
  type CreatorInsightLeanRow,
  type CreatorInsightsSummaryResult,
} from "@/lib/creator/insights-summary";

export type { CreatorInsightItem, ShopSalesEntry } from "@/lib/creator/insights-types";
export type {
  CreatorInsightsGroupPoint,
  CreatorInsightsSummaryMetrics,
  CreatorInsightsSummaryResult,
} from "@/lib/creator/insights-summary";
export type { CreatorInsightsQueryParams } from "@/lib/creator/insights-query";

const COLLECTION = "creator_bitable_items";

type StoredCreatorInsightItem = Omit<CreatorInsightItem, "id" | "importedAt" | "updatedAt"> & {
  createdAt: Date;
  importedAt: Date;
  updatedAt: Date;
};

function valueToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => valueToString(item))
      .filter(Boolean)
      .join("、");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text.trim();
    if (typeof obj.name === "string") return obj.name.trim();
    if (typeof obj.link === "string") return obj.link.trim();
    if (Array.isArray(obj.text_arr)) return obj.text_arr.map((v) => valueToString(v)).join("");
    return "";
  }
  return "";
}

function pickField(fields: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (fields[name] !== undefined && fields[name] !== null && fields[name] !== "") {
      return fields[name];
    }
  }
  return undefined;
}

function pickString(fields: Record<string, unknown>, names: string[]): string {
  return valueToString(pickField(fields, names));
}

function valueToOptionNameString(value: unknown, optionNameMap: Map<string, string>): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const parts = value
      .split(/[、,，]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      return Array.from(new Set(parts.map((part) => optionNameMap.get(part) || part))).join("、");
    }
    return optionNameMap.get(value.trim()) || value.trim();
  }
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => valueToOptionNameString(item, optionNameMap)).filter(Boolean))).join("、");
  }
  const text = valueToString(value);
  return optionNameMap.get(text) || text;
}

function pickOptionNameString(
  fields: Record<string, unknown>,
  names: string[],
  optionNameMap: Map<string, string>
): string {
  return valueToOptionNameString(pickField(fields, names), optionNameMap);
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = valueToString(value).replace(/,/g, "").trim();
  if (!text || text === "-") return null;
  const parsed = Number(text.replace(/%$/, ""));
  if (!Number.isFinite(parsed)) return null;
  return text.endsWith("%") ? parsed / 100 : parsed;
}

function pickNumber(fields: Record<string, unknown>, names: string[], fallback = 0): number {
  return toNumber(pickField(fields, names)) ?? fallback;
}

function pickNullableNumber(fields: Record<string, unknown>, names: string[]): number | null {
  return toNumber(pickField(fields, names));
}

function excelSerialToDate(value: number): Date | null {
  if (!Number.isFinite(value)) return null;
  if (value < 20000 || value > 80000) return null;
  return new Date(Math.round((value - 25569) * 86400 * 1000));
}

function parseDateValue(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const excel = excelSerialToDate(value);
    if (excel) return excel;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = valueToString(value);
  if (!text) return null;
  const parsed = new Date(text.replace(/\./g, "-").replace(/\//g, "-"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateOnly(date: Date | null): string | null {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateTime(date: Date | null): string | null {
  if (!date) return null;
  const datePart = formatDateOnly(date);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${datePart} ${hh}:${mm}:${ss}`;
}

function normalizeWorkMatchText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

/** 抖店成交与抖创作品关联键：仅按作品名（去空白），不按店铺 */
export function buildWorkMatchKey(title: string, _shopName = ""): string {
  return normalizeWorkMatchText(title);
}

function parseShopSalesRecord(fields: Record<string, unknown>) {
  const title = pickString(fields, ["作品名", "作品标题", "作品名称"]);
  const shopName = pickString(fields, ["所属店铺", "店铺"]);
  const salesDate = formatDateOnly(parseDateValue(pickField(fields, ["日期"])));
  const amount = pickNumber(fields, ["增加销售额"], 0);
  if (!title || !salesDate || amount <= 0) return null;
  return { title, shopName, salesDate, amount };
}

export function buildShopSalesIndex(records: unknown[]): Map<string, ShopSalesEntry[]> {
  const grouped = new Map<string, Map<string, number>>();
  for (const record of records) {
    const fields = ((record as any)?.fields || {}) as Record<string, unknown>;
    const parsed = parseShopSalesRecord(fields);
    if (!parsed) continue;
    const key = buildWorkMatchKey(parsed.title);
    const byDate = grouped.get(key) || new Map<string, number>();
    byDate.set(parsed.salesDate, (byDate.get(parsed.salesDate) || 0) + parsed.amount);
    grouped.set(key, byDate);
  }

  const index = new Map<string, ShopSalesEntry[]>();
  for (const [key, byDate] of grouped) {
    index.set(
      key,
      [...byDate.entries()]
        .map(([salesDate, amount]) => ({ salesDate, amount }))
        .sort((a, b) => a.salesDate.localeCompare(b.salesDate))
    );
  }
  return index;
}

function stableRecordId(fields: Record<string, unknown>, index: number): string {
  const key = JSON.stringify({
    title: pickString(fields, ["作品标题", "作品名", "作品名称"]),
    shopName: pickString(fields, ["所属店铺"]),
    publishTime: valueToString(pickField(fields, ["发布时间", "发布日"])),
    index,
  });
  return `local_${crypto.createHash("sha1").update(key).digest("hex").slice(0, 18)}`;
}

function fieldOptionNameMap(field: any): Map<string, string> {
  const options = field?.property?.options;
  if (!Array.isArray(options)) return new Map();
  return new Map(
    options
      .map((option: any) => [String(option?.id || "").trim(), String(option?.name || "").trim()] as const)
      .filter(([id, name]) => id && name)
  );
}

async function buildLookupOptionNameMap(data: any, fieldName: string): Promise<Map<string, string>> {
  const sourceField = data?.fieldMapByName?.[fieldName];
  const targetTable = String(sourceField?.property?.filter_info?.target_table || "").trim();
  const targetField = String(sourceField?.property?.target_field || "").trim();
  if (!targetTable || !targetField) return fieldOptionNameMap(sourceField);

  const cache = await getValidAccessToken(data.config);
  const targetFields = await listBitableFields(data.config, cache.accessToken, targetTable);
  const field = targetFields.find((item: any) => item?.field_id === targetField);
  return fieldOptionNameMap(field);
}

function normalizeCreatorRecord(
  record: any,
  index: number,
  importedAt: Date,
  optionMaps: {
    productionTeam?: Map<string, string>;
    creationType?: Map<string, string>;
    shopSalesIndex?: Map<string, ShopSalesEntry[]>;
  } = {}
): StoredCreatorInsightItem {
  const fields = (record?.fields || {}) as Record<string, unknown>;
  const publishDateValue = pickField(fields, ["发布时间", "发布日"]);
  const publishDate = parseDateValue(publishDateValue);
  const recordId = String(record?.record_id || record?.recordId || "").trim() || stableRecordId(fields, index);
  const title = pickString(fields, ["作品标题", "作品名", "作品名称"]);
  const productionTeamOptionMap = optionMaps.productionTeam || new Map<string, string>();
  const creationTypeOptionMap = optionMaps.creationType || new Map<string, string>();
  const shopName = pickString(fields, ["所属店铺"]);
  const shopSalesEntries = optionMaps.shopSalesIndex?.get(buildWorkMatchKey(title)) || [];

  return {
    recordId,
    title,
    shopName,
    publishTime: formatDateTime(publishDate),
    publishDate: formatDateOnly(publishDate),
    workType: pickString(fields, ["体裁"]),
    creationType: pickOptionNameString(fields, ["类型"], creationTypeOptionMap),
    reviewStatus: pickString(fields, ["审核状态"]),
    playCount: pickNumber(fields, ["播放量"]),
    completionRate: pickNullableNumber(fields, ["完播率"]),
    fiveSecondCompletionRate: pickNullableNumber(fields, ["5秒完播率", "5s完播率"]),
    coverClickRate: pickNullableNumber(fields, ["封面点击率"]),
    twoSecondBounceRate: pickNullableNumber(fields, ["2秒跳出率", "2s跳出率"]),
    avgPlayDuration: pickNullableNumber(fields, ["平播时长", "平均播放时长"]),
    likeCount: pickNumber(fields, ["点赞量"]),
    shareCount: pickNumber(fields, ["分享量"]),
    commentCount: pickNumber(fields, ["评论量"]),
    favoriteCount: pickNumber(fields, ["收藏量"]),
    profileVisitCount: pickNumber(fields, ["主页访量", "主页访问量"]),
    followerCount: pickNumber(fields, ["增粉", "粉丝增量"]),
    salesAmount: pickNumber(fields, ["销售额"]),
    shopSalesEntries,
    productId: pickString(fields, ["商品ID"]),
    relatedProduct: pickString(fields, ["关联产品"]),
    videoLink: pickString(fields, ["视频链接"]),
    productionTeam: pickOptionNameString(fields, ["制作团队"], productionTeamOptionMap),
    rawFields: fields,
    createdAt: importedAt,
    importedAt,
    updatedAt: importedAt,
  };
}

export async function ensureCreatorInsightIndexes() {
  const db = await getDb();
  await db.collection(COLLECTION).createIndexes([
    { key: { recordId: 1 }, name: "recordId_unique", unique: true },
    { key: { shopName: 1, publishDate: -1 }, name: "shop_publishDate" },
    { key: { publishDate: -1 }, name: "publishDate" },
    { key: { playCount: -1 }, name: "playCount" },
  ]);
}

export async function syncCreatorInsightsFromFeishu() {
  await ensureCreatorInsightIndexes();
  process.env.PROJECT_CONFIG_JSON = JSON.stringify(await getConfig());

  process.env.FEISHU_BITABLE_PROFILE = "shop";
  const shopData = await readBitable("shop");
  const shopRecords = Array.isArray(shopData.records) ? shopData.records : [];
  const shopSalesIndex = buildShopSalesIndex(shopRecords);

  process.env.FEISHU_BITABLE_PROFILE = "creator";
  const data = await readBitable("creator");
  const importedAt = new Date();
  const records = Array.isArray(data.records) ? data.records : [];
  const productionTeamMap = await buildLookupOptionNameMap(data, "制作团队");
  const creationTypeMap = await buildLookupOptionNameMap(data, "类型");
  const normalized = records.map((record: unknown, index: number) =>
    normalizeCreatorRecord(record, index, importedAt, {
      productionTeam: productionTeamMap,
      creationType: creationTypeMap,
      shopSalesIndex,
    })
  );
  const db = await getDb();
  let deletedCount = 0;
  if (normalized.length) {
    const activeRecordIds = normalized.map((item) => item.recordId);
    await db.collection(COLLECTION).bulkWrite(
      normalized.map((item) => {
        const { createdAt: _createdAt, ...setFields } = item;
        return {
          updateOne: {
            filter: { recordId: item.recordId },
            update: {
              $set: { ...setFields, updatedAt: importedAt, importedAt },
              $setOnInsert: { createdAt: importedAt },
            },
            upsert: true,
          },
        };
      }),
      { ordered: false }
    );
    const deleteResult = await db.collection(COLLECTION).deleteMany({
      recordId: { $nin: activeRecordIds },
    });
    deletedCount = deleteResult.deletedCount || 0;
  }
  return {
    ok: true,
    importedCount: normalized.length,
    deletedCount,
    shopRecordCount: shopRecords.length,
    shopMatchedCount: normalized.filter((item) => item.shopSalesEntries.length > 0).length,
    fieldCount: Array.isArray(data.fields) ? data.fields.length : 0,
    importedAt: importedAt.toISOString(),
  };
}

const LIST_PROJECTION = {
  recordId: 1,
  title: 1,
  shopName: 1,
  publishTime: 1,
  publishDate: 1,
  workType: 1,
  creationType: 1,
  reviewStatus: 1,
  playCount: 1,
  completionRate: 1,
  fiveSecondCompletionRate: 1,
  coverClickRate: 1,
  twoSecondBounceRate: 1,
  avgPlayDuration: 1,
  likeCount: 1,
  shareCount: 1,
  commentCount: 1,
  favoriteCount: 1,
  profileVisitCount: 1,
  followerCount: 1,
  salesAmount: 1,
  shopSalesEntries: 1,
  productId: 1,
  relatedProduct: 1,
  videoLink: 1,
  productionTeam: 1,
  importedAt: 1,
  updatedAt: 1,
} as const;

const SUMMARY_PROJECTION = {
  title: 1,
  shopName: 1,
  publishDate: 1,
  workType: 1,
  creationType: 1,
  playCount: 1,
  completionRate: 1,
  likeCount: 1,
  shareCount: 1,
  commentCount: 1,
  favoriteCount: 1,
  salesAmount: 1,
  shopSalesEntries: 1,
} as const;

function serializeItem(item: StoredCreatorInsightItem & { _id: unknown }): CreatorInsightItem {
  return {
    ...item,
    creationType: item.creationType || "",
    shopSalesEntries: Array.isArray(item.shopSalesEntries) ? item.shopSalesEntries : [],
    id: String(item._id),
    importedAt: item.importedAt?.toISOString?.() || String(item.importedAt || ""),
    updatedAt: item.updatedAt?.toISOString?.() || String(item.updatedAt || ""),
  };
}

function serializeListItem(item: StoredCreatorInsightItem & { _id: unknown }): Omit<CreatorInsightItem, "rawFields"> {
  const { rawFields: _raw, ...rest } = serializeItem(item);
  return rest;
}

function toLeanRow(item: StoredCreatorInsightItem): CreatorInsightLeanRow {
  return {
    title: item.title || "",
    shopName: item.shopName || "",
    publishDate: item.publishDate || null,
    workType: item.workType || "",
    creationType: item.creationType || "",
    playCount: item.playCount || 0,
    completionRate: item.completionRate ?? null,
    likeCount: item.likeCount || 0,
    shareCount: item.shareCount || 0,
    commentCount: item.commentCount || 0,
    favoriteCount: item.favoriteCount || 0,
    salesAmount: item.salesAmount || 0,
    shopSalesEntries: Array.isArray(item.shopSalesEntries) ? item.shopSalesEntries : [],
  };
}

async function getCreatorInsightsMeta() {
  const db = await getDb();
  const [dbTotal, lastImport] = await Promise.all([
    db.collection(COLLECTION).countDocuments(),
    db
      .collection<StoredCreatorInsightItem>(COLLECTION)
      .find({})
      .sort({ importedAt: -1 })
      .limit(1)
      .next(),
  ]);
  return {
    dbTotal,
    lastImportedAt: lastImport?.importedAt?.toISOString?.() || null,
  };
}

export async function getCreatorInsightsFacets() {
  await ensureCreatorInsightIndexes();
  const db = await getDb();
  const collection = db.collection<StoredCreatorInsightItem>(COLLECTION);
  const [shops, workTypes, creationTypes, reviewStatuses, productionTeams, meta] = await Promise.all([
    collection.distinct("shopName", { shopName: { $exists: true, $ne: "" } }),
    collection.distinct("workType", { workType: { $exists: true, $ne: "" } }),
    collection.distinct("creationType", { creationType: { $exists: true, $ne: "" } }),
    collection.distinct("reviewStatus", { reviewStatus: { $exists: true, $ne: "" } }),
    collection.distinct("productionTeam", { productionTeam: { $exists: true, $ne: "" } }),
    getCreatorInsightsMeta(),
  ]);
  return {
    shops: shops.filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-CN")),
    workTypes: workTypes.filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-CN")),
    creationTypes: creationTypes.filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-CN")),
    reviewStatuses: reviewStatuses.filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-CN")),
    productionTeams: productionTeams.filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-CN")),
    ...meta,
  };
}

export async function listCreatorInsightsPage(params: CreatorInsightsQueryParams) {
  await ensureCreatorInsightIndexes();
  const db = await getDb();
  const filter = buildCreatorInsightsMongoFilter(params, { includePublishDate: true });
  const collection = db.collection<StoredCreatorInsightItem>(COLLECTION);
  const skip = (params.page - 1) * params.pageSize;
  const [items, filteredTotal, meta] = await Promise.all([
    collection
      .find(filter, { projection: LIST_PROJECTION })
      .sort({ publishDate: -1, playCount: -1, updatedAt: -1 })
      .skip(skip)
      .limit(params.pageSize)
      .toArray(),
    collection.countDocuments(filter),
    getCreatorInsightsMeta(),
  ]);
  return {
    items: items.map(serializeListItem),
    page: params.page,
    pageSize: params.pageSize,
    filteredTotal,
    ...meta,
  };
}

export async function getCreatorInsightsSummary(
  params: Pick<
    CreatorInsightsQueryParams,
    "shop" | "workType" | "creationType" | "status" | "teams" | "keyword" | "dateStart" | "dateEnd"
  >
): Promise<CreatorInsightsSummaryResult & { dbTotal: number; lastImportedAt: string | null }> {
  await ensureCreatorInsightIndexes();
  const db = await getDb();
  const tableFilter = buildCreatorInsightsMongoFilter(params, { includePublishDate: true });
  const salesScopeFilter = buildCreatorInsightsMongoFilter(params, { includePublishDate: false });
  const collection = db.collection<StoredCreatorInsightItem>(COLLECTION);
  const salesDateRange =
    params.dateStart && params.dateEnd ? { start: params.dateStart, end: params.dateEnd } : null;
  const chartDateRange = salesDateRange;

  const [tableDocs, salesScopeDocs, meta] = await Promise.all([
    collection.find(tableFilter, { projection: SUMMARY_PROJECTION }).toArray(),
    collection.find(salesScopeFilter, { projection: SUMMARY_PROJECTION }).toArray(),
    getCreatorInsightsMeta(),
  ]);

  const summary = computeCreatorInsightsSummary({
    tableItems: tableDocs.map(toLeanRow),
    salesScopeItems: salesScopeDocs.map(toLeanRow),
    salesDateRange,
    chartDateRange,
  });

  return {
    ...summary,
    ...meta,
  };
}
