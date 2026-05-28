import crypto from "node:crypto";
import { getDb } from "@/lib/db/mongo";
import { getConfig } from "@/lib/configService";
import { readBitable } from "@/lib/feishu/core/readBitable";
import { getValidAccessToken } from "@/lib/feishu/core/oauth";
import { listBitableFields } from "@/lib/feishu/core/bitable";

const COLLECTION = "creator_bitable_items";

export type CreatorInsightItem = {
  id: string;
  recordId: string;
  title: string;
  shopName: string;
  publishTime: string | null;
  publishDate: string | null;
  workType: string;
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
  salesAmount: number;
  productId: string;
  relatedProduct: string;
  videoLink: string;
  productionTeam: string;
  rawFields: Record<string, unknown>;
  importedAt: string;
  updatedAt: string;
};

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
  optionMaps: { productionTeam?: Map<string, string> } = {}
): StoredCreatorInsightItem {
  const fields = (record?.fields || {}) as Record<string, unknown>;
  const publishDateValue = pickField(fields, ["发布时间", "发布日"]);
  const publishDate = parseDateValue(publishDateValue);
  const recordId = String(record?.record_id || record?.recordId || "").trim() || stableRecordId(fields, index);
  const title = pickString(fields, ["作品标题", "作品名", "作品名称"]);
  const productionTeamOptionMap = optionMaps.productionTeam || new Map<string, string>();

  return {
    recordId,
    title,
    shopName: pickString(fields, ["所属店铺"]),
    publishTime: formatDateTime(publishDate),
    publishDate: formatDateOnly(publishDate),
    workType: pickString(fields, ["体裁", "类型"]),
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
  process.env.FEISHU_BITABLE_PROFILE = "creator";
  const data = await readBitable("creator");
  const importedAt = new Date();
  const records = Array.isArray(data.records) ? data.records : [];
  const productionTeamMap = await buildLookupOptionNameMap(data, "制作团队");
  const normalized = records.map((record: unknown, index: number) =>
    normalizeCreatorRecord(record, index, importedAt, { productionTeam: productionTeamMap })
  );
  const db = await getDb();
  if (normalized.length) {
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
  }
  return {
    ok: true,
    importedCount: normalized.length,
    fieldCount: Array.isArray(data.fields) ? data.fields.length : 0,
    importedAt: importedAt.toISOString(),
  };
}

function serializeItem(item: StoredCreatorInsightItem & { _id: unknown }): CreatorInsightItem {
  return {
    ...item,
    id: String(item._id),
    importedAt: item.importedAt?.toISOString?.() || String(item.importedAt || ""),
    updatedAt: item.updatedAt?.toISOString?.() || String(item.updatedAt || ""),
  };
}

export async function listCreatorInsights(options: { limit?: number } = {}) {
  await ensureCreatorInsightIndexes();
  const db = await getDb();
  const limit = Math.min(Math.max(Number(options.limit || 500), 1), 2000);
  const items = await db
    .collection<StoredCreatorInsightItem>(COLLECTION)
    .find({})
    .sort({ publishDate: -1, playCount: -1, updatedAt: -1 })
    .limit(limit)
    .toArray();
  const total = await db.collection(COLLECTION).countDocuments();
  const lastImport = await db
    .collection<StoredCreatorInsightItem>(COLLECTION)
    .find({})
    .sort({ importedAt: -1 })
    .limit(1)
    .next();
  return {
    items: items.map(serializeItem),
    total,
    lastImportedAt: lastImport?.importedAt?.toISOString?.() || null,
  };
}
