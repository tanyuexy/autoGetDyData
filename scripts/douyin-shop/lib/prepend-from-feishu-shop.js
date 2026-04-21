/**
 * 从 config.json 的 feishu.shop（多维表格）拉取记录，将「作品名、日期、增加销售额」等
 * 插入到本地 `data/抖店-全部店铺-每日支付增量汇总.xlsx` **前面**（与 prepend-rows-to-shop-summary 一致）。
 */
require("dotenv").config();

const { loadFeishuConfig } = require("../../feishu/lib/config");
const { getValidAccessToken } = require("../../feishu/lib/oauth");
const {
  listBitableFields,
  listAllBitableRecords
} = require("../../feishu/lib/bitable");
const {
  mergePrependedRowsIntoShopFile,
  normalizeIncomingRow,
  rowHasCoreData
} = require("./prepend-rows-to-shop-summary");

function extractComparableText(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (first && typeof first === "object") {
      if (typeof first.text === "string") return first.text.trim();
      if (Array.isArray(first.record_ids) && first.record_ids.length) {
        return "";
      }
    }
    if (typeof first === "string" || typeof first === "number") {
      return String(first).trim();
    }
  }
  return "";
}

function formatDateMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

/**
 * @param {unknown} raw
 * @param {{ type?: number } | null} meta
 */
function bitableRawToPlain(raw, meta) {
  if (raw === undefined || raw === null) return "";
  const t = meta && typeof meta.type === "number" ? meta.type : -1;

  if (t === 5) {
    if (typeof raw === "number") return formatDateMs(raw);
    const s = extractComparableText(raw);
    if (s) {
      const p = Date.parse(s.replace(/\//g, "-"));
      if (Number.isFinite(p)) return formatDateMs(p);
    }
    return typeof raw === "string" ? raw.trim() : "";
  }
  if (t === 2) {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const s = String(raw).trim().replace(/,/g, "");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : "";
  }
  if (t === 18) {
    return extractComparableText(raw);
  }

  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  return extractComparableText(raw);
}

/**
 * @param {Record<string, unknown>} fields
 * @param {Map<string, { type?: number }>} fieldMetaByName
 */
function bitableFieldsToPlainRow(fields, fieldMetaByName) {
  const row = {};
  for (const key of Object.keys(fields || {})) {
    const meta = fieldMetaByName.get(key) || null;
    row[key] = bitableRawToPlain(fields[key], meta);
  }
  return row;
}

async function fetchShopBitablePlainRows() {
  if (!process.env.FEISHU_BITABLE_PROFILE) {
    process.env.FEISHU_BITABLE_PROFILE = "shop";
  }
  const config = loadFeishuConfig();
  const tokenRecord = await getValidAccessToken(config);
  const tableFields = await listBitableFields(
    config,
    tokenRecord.accessToken
  );
  const fieldMetaByName = new Map(
    tableFields
      .filter((f) => f && String(f.field_name || "").trim())
      .map((f) => [String(f.field_name).trim(), f])
  );

  const records = await listAllBitableRecords(
    config,
    tokenRecord.accessToken
  );

  const plainRows = [];
  for (const item of records) {
    const fields = item && item.fields;
    if (!fields || typeof fields !== "object") continue;
    plainRows.push(bitableFieldsToPlainRow(fields, fieldMetaByName));
  }
  return plainRows;
}

/**
 * @param {{ dryRun?: boolean }} options
 */
async function prependRowsFromFeishuShop(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const plainRows = await fetchShopBitablePlainRows();
  const normalizedIncoming = plainRows
    .map((r) => normalizeIncomingRow(r))
    .filter(rowHasCoreData);

  return mergePrependedRowsIntoShopFile(normalizedIncoming, {
    dryRun,
    sourceDescription: "源表: 飞书多维表格（config.json → feishu.shop）"
  });
}

module.exports = { prependRowsFromFeishuShop, fetchShopBitablePlainRows };
