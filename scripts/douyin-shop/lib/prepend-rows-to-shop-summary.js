const fs = require("fs/promises");
const path = require("path");
const XLSX = require("xlsx");
const {
  OUTPUT_DIR,
  OUTPUT_FILE_NAME,
  OUTPUT_SHEET_NAME,
  ORDERED_HEADERS,
  SOURCE_FIELD,
  SHOP_FIELD,
  OUT_TITLE,
  OUT_DATE,
  OUT_PAY,
  parsePaymentYuan,
  normalizeTitle
} = require("./merge-shop-exports");

/** 源表表头别名 → 规范字段名（与飞书抖店表、导出 xlsx 列名对齐） */
const TITLE_ALIASES = [OUT_TITLE, "作品标题", "作品名称"];
const DATE_ALIASES = [OUT_DATE, "数据日期"];
const PAY_ALIASES = [OUT_PAY, "用户支付金额", "用户支付金额(元)"];

function pickField(row, aliases) {
  for (const key of aliases) {
    if (
      Object.prototype.hasOwnProperty.call(row, key) &&
      row[key] !== undefined &&
      row[key] !== ""
    ) {
      return row[key];
    }
  }
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }
  return "";
}

/** 飞书多维表格文本类字段可能是 [{ text }] 多段结构，拼成一行再交给 normalizeTitle 去空白 */
function coerceTitleRawToString(raw) {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string" || typeof raw === "number") {
    return String(raw);
  }
  if (Array.isArray(raw)) {
    const parts = [];
    for (const item of raw) {
      if (item != null && typeof item === "object" && typeof item.text === "string") {
        parts.push(item.text);
      } else if (typeof item === "string" || typeof item === "number") {
        parts.push(String(item));
      }
    }
    return parts.join("");
  }
  if (typeof raw === "object" && raw !== null && typeof raw.text === "string") {
    return raw.text;
  }
  return String(raw);
}

function normalizeIncomingRow(row) {
  const title = normalizeTitle(coerceTitleRawToString(pickField(row, TITLE_ALIASES)));
  const dateRaw = pickField(row, DATE_ALIASES);
  const dateStr =
    dateRaw instanceof Date
      ? formatDateCell(dateRaw)
      : String(dateRaw ?? "").trim();
  const payRaw = pickField(row, PAY_ALIASES);
  const pay = parsePaymentYuan(payRaw);

  const src = String(row[SOURCE_FIELD] ?? row.数据来源 ?? "").trim();
  const shop = String(row[SHOP_FIELD] ?? row.所属店铺 ?? "").trim();

  return {
    [SOURCE_FIELD]: src,
    [SHOP_FIELD]: shop,
    [OUT_TITLE]: title,
    [OUT_DATE]: dateStr,
    [OUT_PAY]: pay
  };
}

function formatDateCell(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function readSheetRows(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  let name = String(sheetName || "").trim();
  if (name && !workbook.Sheets[name]) {
    name = "";
  }
  if (!name) {
    name = workbook.SheetNames[0] || "";
  }
  if (!name) return { sheetName: "", rows: [] };
  const sheet = workbook.Sheets[name];
  if (!sheet) {
    throw new Error(`未找到 sheet: ${sheetName}`);
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  return { sheetName: name, rows };
}

function rowHasCoreData(norm) {
  return (
    String(norm[OUT_TITLE] || "").trim() !== "" ||
    String(norm[OUT_DATE] || "").trim() !== "" ||
    (typeof norm[OUT_PAY] === "number" && norm[OUT_PAY] !== 0)
  );
}

function ensureRowShape(row) {
  return {
    [SOURCE_FIELD]: row[SOURCE_FIELD] ?? "",
    [SHOP_FIELD]: row[SHOP_FIELD] ?? "",
    [OUT_TITLE]: normalizeTitle(row[OUT_TITLE]),
    [OUT_DATE]: row[OUT_DATE] ?? "",
    [OUT_PAY]:
      typeof row[OUT_PAY] === "number"
        ? row[OUT_PAY]
        : parsePaymentYuan(row[OUT_PAY])
  };
}

/**
 * @param {{ dryRun?: boolean, sourceDescription?: string }} meta
 */
async function mergePrependedRowsIntoShopFile(normalizedIncoming, meta = {}) {
  const dryRun = Boolean(meta.dryRun);
  const sourceDescription = String(meta.sourceDescription || "").trim();

  const targetPath = path.join(OUTPUT_DIR, OUTPUT_FILE_NAME);
  let existing = [];

  const exists = await fs
    .access(targetPath)
    .then(() => true)
    .catch(() => false);

  if (exists) {
    const { rows } = readSheetRows(targetPath, OUTPUT_SHEET_NAME);
    existing = rows.map((r) => ensureRowShape(r)).filter(rowHasCoreData);
  }

  const combined = [...normalizedIncoming, ...existing];

  const head = sourceDescription ? `${sourceDescription}\n` : "";
  console.log(
    `${head}` +
      `有效新行: ${normalizedIncoming.length}，` +
      `原汇总表已有: ${existing.length}，` +
      `合并后: ${combined.length} 行`
  );

  if (dryRun) {
    console.log("dry-run，未写入文件。");
    return {
      targetPath,
      prepended: normalizedIncoming.length,
      kept: existing.length,
      total: combined.length
    };
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const worksheet = XLSX.utils.json_to_sheet(combined, {
    header: ORDERED_HEADERS
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, OUTPUT_SHEET_NAME);
  XLSX.writeFile(workbook, targetPath);

  console.log(`已写入: ${targetPath}`);
  return {
    targetPath,
    prepended: normalizedIncoming.length,
    kept: existing.length,
    total: combined.length
  };
}

/**
 * 将「作品名 / 日期 / 增加销售额」等列读入，插入到抖店汇总表表头数据的**前面**，
 * 原 `data/抖店-全部店铺-每日支付增量汇总.xlsx` 中的行保持顺序接在后面。
 *
 * @param {{ sourceFile: string, sheet?: string, dryRun?: boolean }} options
 */
async function prependRowsToShopSummary(options) {
  const sourceFile = path.resolve(
    process.cwd(),
    String(options.sourceFile || "").trim()
  );
  const sheetOpt = String(options.sheet || "").trim();
  const dryRun = Boolean(options.dryRun);

  await fs.access(sourceFile).catch(() => {
    throw new Error(`源文件不存在: ${sourceFile}`);
  });

  const { sheetName: srcSheet, rows: incoming } = readSheetRows(
    sourceFile,
    sheetOpt
  );
  const normalizedIncoming = incoming
    .map((r) => normalizeIncomingRow(r))
    .filter(rowHasCoreData);

  const desc =
    `源表(本地 xlsx): ${sourceFile}` +
    (srcSheet ? ` (sheet: ${srcSheet})` : "");
  return mergePrependedRowsIntoShopFile(normalizedIncoming, {
    dryRun,
    sourceDescription: desc
  });
}

module.exports = {
  prependRowsToShopSummary,
  mergePrependedRowsIntoShopFile,
  normalizeIncomingRow,
  rowHasCoreData
};
