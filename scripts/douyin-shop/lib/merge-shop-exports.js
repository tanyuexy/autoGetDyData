const fs = require("fs/promises");
const path = require("path");
const XLSX = require("xlsx");
const { ACCOUNTS_DIR } = require("./env");

const OUTPUT_DIR = path.resolve(process.cwd(), "data");
const OUTPUT_FILE_NAME = "抖店-全部店铺-每日支付增量汇总.xlsx";
const OUTPUT_SHEET_NAME = "全部作品";

const SOURCE_FIELD = "数据来源";
const SOURCE_TAG = "抖店";
const SHOP_FIELD = "所属店铺";
/** 与视频/图文明细导出里 append-data-date-column 写入的列名一致 */
const DATA_DATE_FIELD = "数据日期";
const TITLE_FIELD = "作品标题";
const PAY_FIELD = "用户支付金额";

const VIDEO_TITLE_COL = "视频标题";
const VIDEO_PAY_COL = "用户支付金额(元)";
const GRAPHIC_TITLE_COL = "图文标题";
const GRAPHIC_PAY_COL = "用户支付金额";

const ORDERED_HEADERS = [
  SOURCE_FIELD,
  SHOP_FIELD,
  DATA_DATE_FIELD,
  TITLE_FIELD,
  PAY_FIELD
];

function parsePaymentYuan(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const s = String(value).trim().replace(/,/g, "");
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTitle(value) {
  const t = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

async function pickLatestXlsx(dirPath) {
  let names;
  try {
    names = await fs.readdir(dirPath);
  } catch {
    return null;
  }
  let bestPath = null;
  let bestMtime = 0;
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".xlsx")) continue;
    const full = path.join(dirPath, name);
    let st;
    try {
      st = await fs.stat(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const t = st.mtimeMs || 0;
    if (t >= bestMtime) {
      bestMtime = t;
      bestPath = full;
    }
  }
  return bestPath;
}

function readFirstSheetRows(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function cellDateText(row) {
  const raw = row[DATA_DATE_FIELD];
  if (raw === undefined || raw === null) return "";
  const s = String(raw).trim();
  return s;
}

function pushVideoRows(allRows, rows, shopName) {
  for (const row of rows) {
    const pay = parsePaymentYuan(row[VIDEO_PAY_COL]);
    if (pay <= 0) continue;
    const title = normalizeTitle(row[VIDEO_TITLE_COL]);
    allRows.push({
      [SOURCE_FIELD]: SOURCE_TAG,
      [SHOP_FIELD]: shopName,
      [DATA_DATE_FIELD]: cellDateText(row),
      [TITLE_FIELD]: title,
      [PAY_FIELD]: pay
    });
  }
}

function pushGraphicRows(allRows, rows, shopName) {
  for (const row of rows) {
    const pay = parsePaymentYuan(row[GRAPHIC_PAY_COL]);
    if (pay <= 0) continue;
    const title = normalizeTitle(row[GRAPHIC_TITLE_COL]);
    allRows.push({
      [SOURCE_FIELD]: SOURCE_TAG,
      [SHOP_FIELD]: shopName,
      [DATA_DATE_FIELD]: cellDateText(row),
      [TITLE_FIELD]: title,
      [PAY_FIELD]: pay
    });
  }
}

async function collectShopRows(dataRoot, shopName) {
  const rows = [];
  const videoDir = path.join(dataRoot, shopName, "视频明细");
  const graphicDir = path.join(dataRoot, shopName, "图文明细");
  const videoFile = await pickLatestXlsx(videoDir);
  const graphicFile = await pickLatestXlsx(graphicDir);
  if (videoFile) {
    pushVideoRows(rows, readFirstSheetRows(videoFile), shopName);
  }
  if (graphicFile) {
    pushGraphicRows(rows, readFirstSheetRows(graphicFile), shopName);
  }
  return rows;
}

async function listShopNames(dataRoot) {
  let entries;
  try {
    entries = await fs.readdir(dataRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * 扫描 accounts-shop 下各账号 data/<店铺>/视频明细|图文明细 中最新 xlsx，
 * 过滤用户支付金额为 0 的行，统一为「作品标题」「用户支付金额」，并写入 data/抖店-….
 */
async function mergeAllShopExportsToData() {
  const allRows = [];
  let accountDirs;
  try {
    accountDirs = await fs.readdir(ACCOUNTS_DIR, { withFileTypes: true });
  } catch {
    accountDirs = [];
  }

  for (const ent of accountDirs) {
    if (!ent.isDirectory()) continue;
    const dataRoot = path.join(ACCOUNTS_DIR, ent.name, "data");
    const shops = await listShopNames(dataRoot);
    for (const shopName of shops) {
      const chunk = await collectShopRows(dataRoot, shopName);
      allRows.push(...chunk);
    }
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE_NAME);

  try {
    const names = await fs.readdir(OUTPUT_DIR);
    for (const name of names) {
      if (name === OUTPUT_FILE_NAME) continue;
      if (name.startsWith("抖店-") && name.toLowerCase().endsWith(".xlsx")) {
        await fs.unlink(path.join(OUTPUT_DIR, name)).catch(() => {});
      }
    }
  } catch {
    // ignore
  }

  const worksheet = XLSX.utils.json_to_sheet(allRows, {
    header: ORDERED_HEADERS
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, OUTPUT_SHEET_NAME);
  XLSX.writeFile(workbook, outputPath);

  console.log(
    `抖店汇总完成（共 ${allRows.length} 条，用户支付金额>0）: ${outputPath}`
  );
  return { outputPath, rowCount: allRows.length };
}

module.exports = { mergeAllShopExportsToData, OUTPUT_FILE_NAME };
