const fs = require("fs/promises");
const path = require("path");
const XLSX = require("xlsx");
const { ACCOUNTS_DIR } = require("./env");

const OUTPUT_DIR = path.resolve(process.cwd(), "data");
const OUTPUT_FILE_NAME = "抖店-全部店铺-每日支付增量汇总.xlsx";
const BACKUP_FILE_NAME = "抖店-飞书表备份.xlsx";
const OUTPUT_SHEET_NAME = "全部作品";

/** 视频/图文明细里 append-data-date-column 写入的列名（源表读取用） */
const SOURCE_DATA_DATE_COL = "数据日期";

const SOURCE_FIELD = "数据来源";
const SOURCE_TAG = "抖店";
const SHOP_FIELD = "所属店铺";
/** 与飞书抖店表主数据列一致 */
const OUT_TITLE = "作品名";
const OUT_DATE = "日期";
const OUT_PAY = "增加销售额";

const VIDEO_TITLE_COL = "视频标题";
const VIDEO_PAY_COL = "用户支付金额(元)";
const GRAPHIC_TITLE_COL = "图文标题";
const GRAPHIC_PAY_COL = "用户支付金额";

const ORDERED_HEADERS = [
  SOURCE_FIELD,
  SHOP_FIELD,
  OUT_TITLE,
  OUT_DATE,
  OUT_PAY
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

/** 作品名列写入汇总 xlsx 前去掉所有空白（含空格、制表、全角空格等） */
function normalizeTitle(value) {
  return String(value ?? "").replace(/\s/g, "");
}

/** 返回目录下最新的 xlsx 文件路径列表（按修改时间倒序），不存在则返回 [] */
async function pickLatestXlsxFiles(dirPath) {
  let names;
  try {
    names = await fs.readdir(dirPath);
  } catch {
    return [];
  }
  const files = [];
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
    files.push({ path: full, mtime: st.mtimeMs || 0 });
  }
  if (!files.length) return [];
  files.sort((a, b) => b.mtime - a.mtime);
  return files.map((f) => f.path);
}

function readFirstSheetRows(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function cellDateText(row) {
  const raw = row[SOURCE_DATA_DATE_COL];
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
      [OUT_TITLE]: title,
      [OUT_DATE]: cellDateText(row),
      [OUT_PAY]: pay
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
      [OUT_TITLE]: title,
      [OUT_DATE]: cellDateText(row),
      [OUT_PAY]: pay
    });
  }
}

/** 检查文件首行表头是否包含「数据日期」列 */
function hasDateColumn(headers) {
  return headers.some((h) => String(h ?? "").trim() === SOURCE_DATA_DATE_COL);
}

async function collectShopRows(dataRoot, shopName, options = {}) {
  const rows = [];
  const daysToExport = Math.max(1, Number(options.daysToExport) || 1);
  const videoDir = path.join(dataRoot, shopName, "视频明细");
  const graphicDir = path.join(dataRoot, shopName, "图文明细");
  const latestVideoFiles = (await pickLatestXlsxFiles(videoDir)).slice(
    0,
    daysToExport
  );
  const latestGraphicFiles = (await pickLatestXlsxFiles(graphicDir)).slice(
    0,
    daysToExport
  );
  const seen = new Set();

  function processLatestFiles(filePaths, pushFn, typeName) {
    for (const filePath of filePaths) {
      const sheetRows = readFirstSheetRows(filePath);
      if (!sheetRows.length) continue;
      // 循环导出的文件若缺少日期列则跳过，避免空日期进入汇总
      if (!hasDateColumn(Object.keys(sheetRows[0] || {}))) {
        console.warn(
          `  跳过${typeName}文件（缺少「${SOURCE_DATA_DATE_COL}」列）: ${filePath}`
        );
        continue;
      }
      pushFn(rows, sheetRows, shopName);
    }
  }

  processLatestFiles(latestVideoFiles, pushVideoRows, "视频");
  processLatestFiles(latestGraphicFiles, pushGraphicRows, "图文");

  // 按(作品名, 日期)去重，保留第一条
  const deduped = [];
  for (const r of rows) {
    const key = `${r[OUT_TITLE]}|${r[OUT_DATE]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  // 按日期排序（旧→新）
  deduped.sort((a, b) => {
    if (a[OUT_DATE] < b[OUT_DATE]) return -1;
    if (a[OUT_DATE] > b[OUT_DATE]) return 1;
    return 0;
  });
  return deduped;
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
 * 扫描 accounts-shop 下各账号 data/<店铺>/视频明细|图文明细 中最近 N 个 xlsx（N=daysToExport），
 * 按(作品名,日期)去重并排序后输出为「数据来源」「所属店铺」「作品名」「日期」「增加销售额」，写入 data/抖店-….
 */
async function mergeAllShopExportsToData(options = {}) {
  const allRows = [];
  const daysToExport = Math.max(1, Number(options.daysToExport) || 1);
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
      const chunk = await collectShopRows(dataRoot, shopName, { daysToExport });
      allRows.push(...chunk);
    }
  }

  // 全局按日期排序（旧→新），同日期下按店铺与作品名稳定排序，便于对账与比对
  allRows.sort((a, b) => {
    if (a[OUT_DATE] < b[OUT_DATE]) return -1;
    if (a[OUT_DATE] > b[OUT_DATE]) return 1;
    if (a[SHOP_FIELD] < b[SHOP_FIELD]) return -1;
    if (a[SHOP_FIELD] > b[SHOP_FIELD]) return 1;
    if (a[OUT_TITLE] < b[OUT_TITLE]) return -1;
    if (a[OUT_TITLE] > b[OUT_TITLE]) return 1;
    return 0;
  });

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE_NAME);

  try {
    const names = await fs.readdir(OUTPUT_DIR);
    for (const name of names) {
      if (name === OUTPUT_FILE_NAME || name === BACKUP_FILE_NAME) continue;
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
    `抖店汇总完成（最近 ${daysToExport} 天文件，共 ${allRows.length} 条，增加销售额>0）: ${outputPath}`
  );
  return { outputPath, rowCount: allRows.length };
}

module.exports = {
  mergeAllShopExportsToData,
  OUTPUT_FILE_NAME,
  OUTPUT_SHEET_NAME,
  OUTPUT_DIR,
  ORDERED_HEADERS,
  SOURCE_FIELD,
  SHOP_FIELD,
  OUT_TITLE,
  OUT_DATE,
  OUT_PAY,
  SOURCE_TAG,
  parsePaymentYuan,
  normalizeTitle
};
