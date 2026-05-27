const fse = require("fs-extra");
const path = require("path");
const XLSX = require("xlsx");
const { ACCOUNTS_DIR } = require("./env");
const { getInternalApiBaseUrl } = require("../../common/internal-api-client");

const OUTPUT_DIR = (() => {
  const envVal = process.env.EXPORTS_DIR;
  if (envVal) return path.resolve(process.cwd(), envVal);
  const newPath = path.resolve(process.cwd(), "storage/exports");
  const oldPath = path.resolve(process.cwd(), "data");
  if (fse.existsSync(oldPath) && !fse.existsSync(newPath)) {
    console.warn("[migration] 正在使用旧目录 \"data/\"，建议移动到 \"storage/exports/\" 或设置 EXPORTS_DIR");
    return oldPath;
  }
  return newPath;
})();
const OUTPUT_FILE_NAME = "抖店-全部店铺-每日支付增量汇总.xlsx";
const CREATOR_OUTPUT_FILE_NAME = "抖创-全部店铺-作品列表.xlsx";
const BACKUP_FILE_NAME = "抖店-飞书表备份.xlsx";
const OUTPUT_SHEET_NAME = "全部作品";
const DATA_DATE_COLUMN = "数据日期";

/** 视频/图文明细里写入的列名（源表读取用） */
const SOURCE_DATA_DATE_COL = DATA_DATE_COLUMN;

const SOURCE_FIELD = "数据来源";
const SOURCE_TAG = "抖店";
const SHOP_FIELD = "所属店铺";
/** 与飞书抖店表主数据列一致 */
const OUT_TITLE = "作品名";
const OUT_DATE = "日期";
const OUT_DEAL_TYPE = "成交类型";
const OUT_PAY = "增加销售额";

const VIDEO_TITLE_COL = "视频标题";
const GRAPHIC_TITLE_COL = "图文标题";
const CREATOR_TITLE_COLS = ["作品名称", "作品名"];

const VIDEO_AD_DIR = {
  NON_AD: "非投放",
  AD: "投放"
};

const SALES_AMOUNT_FIELDS = [
  {
    type: "用户支付金额",
    videoColumns: ["用户支付金额(元)", "用户支付金额"],
    graphicColumns: ["用户支付金额", "用户支付金额(元)"]
  },
  {
    type: "看后搜用户支付金额",
    videoColumns: ["看后搜用户支付金额(元)", "看后搜用户支付金额"],
    graphicColumns: ["看后搜用户支付金额", "看后搜用户支付金额(元)"]
  },
  {
    type: "引流店铺页用户支付金额",
    videoColumns: ["引流店铺页用户支付金额(元)", "引流店铺页用户支付金额"],
    graphicColumns: ["引流店铺页用户支付金额", "引流店铺页用户支付金额(元)"]
  },
  {
    type: "引流其他用户支付金额",
    videoColumns: ["引流其他页用户支付金额(元)", "引流其他页用户支付金额"],
    graphicColumns: ["引流其他页用户支付金额", "引流其他页用户支付金额(元)"]
  }
];

const ORDERED_HEADERS = [
  SOURCE_FIELD,
  SHOP_FIELD,
  OUT_TITLE,
  OUT_DATE,
  OUT_DEAL_TYPE,
  OUT_PAY
];

function appendDataDateColumn(filePath, dataDate) {
  if (dataDate == null || String(dataDate).trim() === "") return;

  const value = String(dataDate).trim();
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return;
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: ""
  });
  if (!rows.length) return;

  let maxCols = 0;
  for (const row of rows) {
    const len = Array.isArray(row) ? row.length : 0;
    if (len > maxCols) maxCols = len;
  }

  const headerRow = Array.isArray(rows[0]) ? [...rows[0]] : [];
  while (headerRow.length < maxCols) headerRow.push("");
  const headers = headerRow.map((c) => String(c ?? "").trim());
  let colIdx = headers.indexOf(DATA_DATE_COLUMN);
  if (colIdx === -1) {
    colIdx = headers.length;
    headerRow.push(DATA_DATE_COLUMN);
    rows[0] = headerRow;
  }

  for (let r = 1; r < rows.length; r += 1) {
    if (!Array.isArray(rows[r])) rows[r] = [];
    const row = rows[r];
    while (row.length <= colIdx) row.push("");
    row[colIdx] = value;
  }

  const newSheet = XLSX.utils.aoa_to_sheet(rows);
  workbook.Sheets[sheetName] = newSheet;
  XLSX.writeFile(workbook, filePath);
}

async function calcDaysToExport() {
  const baseUrl = getInternalApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/shop/export`, { cache: "no-store" });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(data.error || data.raw || `HTTP ${response.status}`);
  }
  return Number(data.daysToExport) > 0 ? Number(data.daysToExport) : 1;
}

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

function readCreatorTitleFromRow(row) {
  for (const col of CREATOR_TITLE_COLS) {
    if (col in row) {
      const title = normalizeTitle(row[col]);
      if (title) return title;
    }
  }
  return "";
}

function loadCreatorTitleIndex() {
  const creatorPath = path.join(OUTPUT_DIR, CREATOR_OUTPUT_FILE_NAME);
  if (!fse.existsSync(creatorPath)) {
    console.warn(`未找到抖创汇总表 ${creatorPath}，投放视频将不会按抖创标题过滤`);
    return [];
  }

  const rows = readFirstSheetRows(creatorPath);
  const shopMap = new Map();
  for (const row of rows) {
    const shopName = String(row[SHOP_FIELD] || "").trim();
    const title = readCreatorTitleFromRow(row);
    if (!shopName || !title) continue;
    if (!shopMap.has(shopName)) shopMap.set(shopName, new Set());
    shopMap.get(shopName).add(title);
  }

  const entries = [...shopMap.entries()].map(([shopName, titles]) => ({
    shopName,
    titles
  }));
  console.log(
    `已加载抖创标题索引：${entries.length} 个店铺，共 ${entries.reduce((n, e) => n + e.titles.size, 0)} 个标题`
  );
  return entries;
}

function getCreatorTitlesForShop(shopName, creatorEntries) {
  const titles = new Set();
  for (const entry of creatorEntries) {
    if (
      matchesPreferredShop(shopName, [entry.shopName]) ||
      matchesPreferredShop(entry.shopName, [shopName])
    ) {
      for (const title of entry.titles) titles.add(title);
    }
  }
  return titles;
}

function isLegacyAdVideoFile(filePath) {
  const base = path.basename(filePath);
  if (base.includes("非投放")) return false;
  return base.includes("投放") || base.includes("{投放}");
}

function isLegacyNonAdVideoFile(filePath) {
  const base = path.basename(filePath);
  if (isLegacyAdVideoFile(filePath)) return false;
  return base.includes("非投放") || base.includes("{非投放}") || !base.includes("投放");
}

async function pickVideoExportFiles(videoBaseDir, adDirLabel, options = {}) {
  const daysToExport = Math.max(1, Number(options.daysToExport) || 1);
  const subDir = path.join(videoBaseDir, adDirLabel);
  let files = await pickLatestXlsxFiles(subDir, options);
  if (files.length >= daysToExport) {
    return files.slice(0, daysToExport);
  }

  const flatFiles = await pickLatestXlsxFiles(videoBaseDir, options);
  const legacyFilter =
    adDirLabel === VIDEO_AD_DIR.AD ? isLegacyAdVideoFile : isLegacyNonAdVideoFile;
  const legacyFiles = flatFiles.filter(legacyFilter);
  if (legacyFiles.length > 0) {
    return legacyFiles.slice(0, daysToExport);
  }
  return files.slice(0, daysToExport);
}

function calcExpectedDates(daysToExport) {
  const days = Math.max(1, Number(daysToExport) || 1);
  const result = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - 1 - offset);
    d.setHours(0, 0, 0, 0);
    result.push(fmtDateYMD(d));
  }
  return result;
}

function matchesPreferredShop(shopName, preferredShopNames = []) {
  if (!preferredShopNames.length) return true;
  const name = String(shopName || "").trim();
  if (!name) return false;
  return preferredShopNames.some((item) => {
    const pref = String(item || "").trim();
    if (!pref) return false;
    return name === pref || name.includes(pref) || pref.includes(name);
  });
}

function matchesExportBatch(filePath, exportBatchId) {
  if (!exportBatchId) return true;
  return path.basename(filePath).startsWith(`${exportBatchId}-`);
}

/** 返回目录下最新的 xlsx 文件路径列表（按修改时间倒序），不存在则返回 [] */
async function pickLatestXlsxFiles(dirPath, options = {}) {
  const exportBatchId = options.exportBatchId || null;
  let names;
  try {
    names = await fse.readdir(dirPath);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".xlsx")) continue;
    const full = path.join(dirPath, name);
    let st;
    try {
      st = await fse.stat(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (!matchesExportBatch(full, exportBatchId)) continue;
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

function fmtDateYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function normalizeDateYMD(value) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return fmtDateYMD(value);
  }

  const s = String(value).trim();
  if (!s) return "";

  const ymd = s.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (ymd) {
    const y = ymd[1];
    const m = String(Number(ymd[2])).padStart(2, "0");
    const d = String(Number(ymd[3])).padStart(2, "0");
    return `${y}/${m}/${d}`;
  }

  const dt = new Date(s.replace(/\//g, "-"));
  if (!Number.isNaN(dt.getTime())) {
    return fmtDateYMD(dt);
  }

  return "";
}

/** 从导出文件名 `[20260525-20260525]` 解析数据日期（空表兜底） */
function parseDataDatesFromExportFileName(filePath) {
  const base = path.basename(filePath);
  const match = base.match(/\[(\d{8})-(\d{8})\]/);
  if (!match) return [];

  const toNorm = (raw) =>
    normalizeDateYMD(`${raw.slice(0, 4)}/${raw.slice(4, 6)}/${raw.slice(6, 8)}`);
  const start = toNorm(match[1]);
  const end = toNorm(match[2]);
  if (!start) return [];
  if (!end || start === end) return [start];

  const result = [];
  const cursor = new Date(
    Number(match[1].slice(0, 4)),
    Number(match[1].slice(4, 6)) - 1,
    Number(match[1].slice(6, 8))
  );
  const endDate = new Date(
    Number(match[2].slice(0, 4)),
    Number(match[2].slice(4, 6)) - 1,
    Number(match[2].slice(6, 8))
  );
  cursor.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= endDate.getTime()) {
    result.push(fmtDateYMD(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function collectDataDatesFromSheetRows(sheetRows) {
  const dates = [];
  if (!sheetRows.length) return dates;
  if (!hasDateColumn(Object.keys(sheetRows[0] || {}))) return dates;
  for (const row of sheetRows) {
    const normalized = normalizeDateYMD(row[SOURCE_DATA_DATE_COL]);
    if (normalized) dates.push(normalized);
  }
  return dates;
}

function readPaymentAmount(row, candidateColumns) {
  for (const column of candidateColumns) {
    if (!(column in row)) continue;
    const value = parsePaymentYuan(row[column]);
    if (value > 0) return value;
  }
  return 0;
}

function pushSalesRows(allRows, row, shopName, title, candidateGroups) {
  for (const group of candidateGroups) {
    const pay = readPaymentAmount(row, group.columns);
    if (pay <= 0) continue;
    allRows.push({
      [SOURCE_FIELD]: SOURCE_TAG,
      [SHOP_FIELD]: shopName,
      [OUT_TITLE]: title,
      [OUT_DATE]: cellDateText(row),
      [OUT_DEAL_TYPE]: group.type,
      [OUT_PAY]: pay
    });
  }
}

function pushVideoRows(allRows, rows, shopName, options = {}) {
  const saleGroups = SALES_AMOUNT_FIELDS.map((item) => ({
    type: item.type,
    columns: item.videoColumns
  }));
  const titleFilter = options.titleFilter || null;
  let skipped = 0;
  let matched = 0;
  let keptRows = 0;
  const matchedTitles = new Set();

  for (const row of rows) {
    const title = normalizeTitle(row[VIDEO_TITLE_COL]);
    if (!title) continue;
    if (titleFilter && !titleFilter.has(title)) {
      skipped += 1;
      continue;
    }
    if (titleFilter) {
      matched += 1;
      matchedTitles.add(title);
    }
    const before = allRows.length;
    pushSalesRows(allRows, row, shopName, title, saleGroups);
    if (allRows.length > before) keptRows += 1;
  }

  if (titleFilter && options.adType === VIDEO_AD_DIR.AD) {
    const total = matched + skipped;
    const titles = [...matchedTitles];
    console.log(
      `  [${shopName}] 投放视频标题匹配 ${matched}/${total} 条，命中 ${titles.length} 个作品名，写入汇总 ${keptRows} 条源行，跳过 ${skipped} 条`
    );
  }
}

function pushGraphicRows(allRows, rows, shopName) {
  const saleGroups = SALES_AMOUNT_FIELDS.map((item) => ({
    type: item.type,
    columns: item.graphicColumns
  }));
  for (const row of rows) {
    const title = normalizeTitle(row[GRAPHIC_TITLE_COL]);
    pushSalesRows(allRows, row, shopName, title, saleGroups);
  }
}

/** 检查文件首行表头是否包含「数据日期」列 */
function hasDateColumn(headers) {
  return headers.some((h) => String(h ?? "").trim() === SOURCE_DATA_DATE_COL);
}

async function collectShopRows(dataRoot, shopName, options = {}) {
  const rows = [];
  const daysToExport = Math.max(1, Number(options.daysToExport) || 1);
  const exportBatchId = options.exportBatchId || null;
  const creatorEntries = Array.isArray(options.creatorEntries)
    ? options.creatorEntries
    : [];
  const videoDir = path.join(dataRoot, shopName, "视频明细");
  const graphicDir = path.join(dataRoot, shopName, "图文明细");
  const latestNonAdVideoFiles = await pickVideoExportFiles(videoDir, VIDEO_AD_DIR.NON_AD, {
    daysToExport,
    exportBatchId
  });
  const latestAdVideoFiles = await pickVideoExportFiles(videoDir, VIDEO_AD_DIR.AD, {
    daysToExport,
    exportBatchId
  });
  const latestGraphicFiles = (await pickLatestXlsxFiles(graphicDir, { exportBatchId })).slice(
    0,
    daysToExport
  );
  const seen = new Set();
  const collectedDates = new Set();
  const videoDates = new Set();
  const videoNonAdDates = new Set();
  const videoAdDates = new Set();
  const graphicDates = new Set();
  const creatorTitles = getCreatorTitlesForShop(shopName, creatorEntries);

  function processLatestFiles(filePaths, pushFn, typeName, dateSet, pushOptions = {}) {
    for (const filePath of filePaths) {
      const sheetRows = readFirstSheetRows(filePath);
      let datesFromFile = collectDataDatesFromSheetRows(sheetRows);
      if (!datesFromFile.length && sheetRows.length) {
        console.warn(
          `  跳过${typeName}文件（缺少「${SOURCE_DATA_DATE_COL}」列）: ${filePath}`
        );
      }
      if (!datesFromFile.length) {
        datesFromFile = parseDataDatesFromExportFileName(filePath);
        if (datesFromFile.length > 0 && sheetRows.length === 0) {
          console.log(
            `  ${typeName}文件无数据行，下载成功，按文件名认定日期: ${datesFromFile.join(", ")}`
          );
        }
      }
      for (const normalized of datesFromFile) dateSet.add(normalized);
      if (sheetRows.length) {
        pushFn(rows, sheetRows, shopName, pushOptions);
      }
    }
  }

  processLatestFiles(
    latestNonAdVideoFiles,
    pushVideoRows,
    "视频非投放",
    videoNonAdDates
  );
  processLatestFiles(
    latestAdVideoFiles,
    pushVideoRows,
    "视频投放",
    videoAdDates,
    {
      titleFilter: creatorTitles,
      adType: VIDEO_AD_DIR.AD
    }
  );
  processLatestFiles(latestGraphicFiles, pushGraphicRows, "图文", graphicDates);
  for (const date of videoNonAdDates) {
    videoDates.add(date);
    collectedDates.add(date);
  }
  for (const date of videoAdDates) {
    videoDates.add(date);
    collectedDates.add(date);
  }
  for (const date of graphicDates) collectedDates.add(date);

  // 按(作品名, 日期, 成交类型)去重，保留第一条（非投放优先）
  const deduped = [];
  for (const r of rows) {
    const key = `${r[OUT_TITLE]}|${r[OUT_DATE]}|${r[OUT_DEAL_TYPE]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
    const normalized = normalizeDateYMD(r[OUT_DATE]);
    if (normalized) collectedDates.add(normalized);
  }
  // 按日期排序（旧→新）
  deduped.sort((a, b) => {
    if (a[OUT_DATE] < b[OUT_DATE]) return -1;
    if (a[OUT_DATE] > b[OUT_DATE]) return 1;
    return 0;
  });
  return {
    rows: deduped,
    collectedDates,
    videoDates,
    videoNonAdDates,
    videoAdDates,
    graphicDates,
    videoFiles: latestNonAdVideoFiles,
    videoAdFiles: latestAdVideoFiles,
    graphicFiles: latestGraphicFiles
  };
}

async function listShopNames(dataRoot) {
  let entries;
  try {
    entries = await fse.readdir(dataRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function validateShopExportFiles(options = {}) {
  const daysToExport = Math.max(1, Number(options.daysToExport) || 1);
  const exportBatchId = options.exportBatchId || null;
  const creatorEntries = loadCreatorTitleIndex();
  const expectedDates = calcExpectedDates(daysToExport);
  const preferredShopNames = Array.isArray(options.preferredShopNames)
    ? options.preferredShopNames.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  const processedAccountEmails = Array.isArray(options.processedAccountEmails)
    ? options.processedAccountEmails.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  const problems = [];
  const shopReports = [];
  const candidateReports = [];
  let accountDirs;
  try {
    accountDirs = await fse.readdir(ACCOUNTS_DIR, { withFileTypes: true });
  } catch {
    accountDirs = [];
  }

  const accountNameAllowed = (accountName) => {
    if (processedAccountEmails.length === 0) return true;
    return processedAccountEmails.includes(accountName);
  };

  for (const ent of accountDirs) {
    if (!ent.isDirectory()) continue;
    if (!accountNameAllowed(ent.name)) continue;
    const dataRoot = path.join(ACCOUNTS_DIR, ent.name, "data");
    const shops = (await listShopNames(dataRoot)).filter((shopName) =>
      matchesPreferredShop(shopName, preferredShopNames)
    );
    for (const shopName of shops) {
      const chunk = await collectShopRows(dataRoot, shopName, {
        daysToExport,
        exportBatchId,
        creatorEntries
      });
      const videoDates = [...chunk.videoDates].sort();
      const videoNonAdDates = [...chunk.videoNonAdDates].sort();
      const videoAdDates = [...chunk.videoAdDates].sort();
      const graphicDates = [...chunk.graphicDates].sort();
      const missingVideoDates = expectedDates.filter((d) => !chunk.videoDates.has(d));
      const missingVideoNonAdDates = expectedDates.filter((d) => !chunk.videoNonAdDates.has(d));
      const missingVideoAdDates = expectedDates.filter((d) => !chunk.videoAdDates.has(d));
      const missingGraphicDates = expectedDates.filter((d) => !chunk.graphicDates.has(d));
      const report = {
        account: ent.name,
        shopName,
        videoFiles: chunk.videoFiles.length,
        videoAdFiles: chunk.videoAdFiles.length,
        graphicFiles: chunk.graphicFiles.length,
        videoDates,
        videoNonAdDates,
        videoAdDates,
        graphicDates,
        missingVideoDates,
        missingVideoNonAdDates,
        missingVideoAdDates,
        missingGraphicDates,
        ok:
          chunk.videoFiles.length >= daysToExport &&
          chunk.videoAdFiles.length >= daysToExport &&
          chunk.graphicFiles.length >= daysToExport &&
          missingVideoNonAdDates.length === 0 &&
          missingVideoAdDates.length === 0 &&
          missingGraphicDates.length === 0
      };
      candidateReports.push(report);
    }
  }

  const expectedShops = preferredShopNames.length > 0
    ? preferredShopNames
    : [...new Set(candidateReports.map((report) => report.shopName).filter(Boolean))];

  for (const expectedShop of expectedShops) {
    const matchedReports = candidateReports.filter((report) =>
      matchesPreferredShop(report.shopName, [expectedShop])
    );
    const okReport = matchedReports.find((report) => report.ok);

    if (okReport) {
      shopReports.push({ ...okReport, expectedShop });
      continue;
    }

    if (matchedReports.length === 0) {
      problems.push(`[${expectedShop}] 未找到该目标店铺的本地导出文件`);
      continue;
    }

    shopReports.push({ ...matchedReports[0], expectedShop });
    const detailPrefix = `[${expectedShop}]`;
    const locations = matchedReports.map((report) => `${report.account}/${report.shopName}`).join("；");
    problems.push(`${detailPrefix} 已找到店铺目录但本批次导出不完整，检查位置: ${locations}`);

    const hasEnoughVideoNonAd = matchedReports.some((report) => report.videoFiles >= daysToExport);
    const hasEnoughVideoAd = matchedReports.some((report) => report.videoAdFiles >= daysToExport);
    const hasEnoughGraphic = matchedReports.some((report) => report.graphicFiles >= daysToExport);
    const hasAllVideoNonAdDates = matchedReports.some(
      (report) => report.missingVideoNonAdDates.length === 0
    );
    const hasAllVideoAdDates = matchedReports.some(
      (report) => report.missingVideoAdDates.length === 0
    );
    const hasAllGraphicDates = matchedReports.some((report) => report.missingGraphicDates.length === 0);

    if (!hasEnoughVideoNonAd) {
      const actual = Math.max(...matchedReports.map((report) => report.videoFiles));
      problems.push(`${detailPrefix} 视频非投放文件数量不足：期望 ${daysToExport} 个，最多找到 ${actual} 个`);
    }
    if (!hasEnoughVideoAd) {
      const actual = Math.max(...matchedReports.map((report) => report.videoAdFiles || 0));
      problems.push(`${detailPrefix} 视频投放文件数量不足：期望 ${daysToExport} 个，最多找到 ${actual} 个`);
    }
    if (!hasEnoughGraphic) {
      const actual = Math.max(...matchedReports.map((report) => report.graphicFiles));
      problems.push(`${detailPrefix} 图文文件数量不足：期望 ${daysToExport} 个，最多找到 ${actual} 个`);
    }
    if (!hasAllVideoNonAdDates) {
      const actualDates = [...new Set(matchedReports.flatMap((report) => report.videoNonAdDates || []))].sort();
      const missingDates = expectedDates.filter((date) => !actualDates.includes(date));
      problems.push(`${detailPrefix} 视频非投放缺少日期：${missingDates.join(", ")}；实际日期=${actualDates.join(", ") || "(空)"}`);
    }
    if (!hasAllVideoAdDates) {
      const actualDates = [...new Set(matchedReports.flatMap((report) => report.videoAdDates || []))].sort();
      const missingDates = expectedDates.filter((date) => !actualDates.includes(date));
      problems.push(`${detailPrefix} 视频投放缺少日期：${missingDates.join(", ")}；实际日期=${actualDates.join(", ") || "(空)"}`);
    }
    if (!hasAllGraphicDates) {
      const actualDates = [...new Set(matchedReports.flatMap((report) => report.graphicDates))].sort();
      const missingDates = expectedDates.filter((date) => !actualDates.includes(date));
      problems.push(`${detailPrefix} 图文缺少日期：${missingDates.join(", ")}；实际日期=${actualDates.join(", ") || "(空)"}`);
    }
  }

  return {
    ok: problems.length === 0,
    expectedDates,
    problems,
    shopReports,
    candidateReports
  };
}

/**
 * 扫描 accounts-shop 下各账号 data/<店铺>/视频明细|图文明细 中最近 N 个 xlsx（N=daysToExport），
 * 按(作品名,日期,成交类型)去重并排序后输出为
 * 「数据来源」「所属店铺」「作品名」「日期」「成交类型」「增加销售额」，写入 data/抖店-….
 */
async function mergeAllShopExportsToData(options = {}) {
  const allRows = [];
  const daysToExport = Math.max(1, Number(options.daysToExport) || 1);
  const exportBatchId = options.exportBatchId || null;
  const preferredShopNames = Array.isArray(options.preferredShopNames)
    ? options.preferredShopNames.filter((name) => String(name || "").trim())
    : [];
  const creatorEntries = loadCreatorTitleIndex();
  let accountDirs;
  try {
    accountDirs = await fse.readdir(ACCOUNTS_DIR, { withFileTypes: true });
  } catch {
    accountDirs = [];
  }

  const expectedDateSet = new Set(calcExpectedDates(daysToExport));
  const actualDateSet = new Set();

  for (const ent of accountDirs) {
    if (!ent.isDirectory()) continue;
    const dataRoot = path.join(ACCOUNTS_DIR, ent.name, "data");
    const shops = (await listShopNames(dataRoot)).filter((shopName) =>
      matchesPreferredShop(shopName, preferredShopNames)
    );
    for (const shopName of shops) {
      const chunk = await collectShopRows(dataRoot, shopName, {
        daysToExport,
        exportBatchId,
        creatorEntries
      });
      allRows.push(...chunk.rows);
      for (const d of chunk.collectedDates) actualDateSet.add(d);
    }
  }

  const globallyDedupedRows = [];
  const globalSeen = new Set();
  for (const row of allRows) {
    const key = [
      row[SHOP_FIELD],
      row[OUT_TITLE],
      row[OUT_DATE],
      row[OUT_DEAL_TYPE]
    ].join("|");
    if (globalSeen.has(key)) continue;
    globalSeen.add(key);
    globallyDedupedRows.push(row);
  }

  // 全局按日期排序（旧→新），同日期下按店铺与作品名稳定排序，便于对账与比对
  globallyDedupedRows.sort((a, b) => {
    if (a[OUT_DATE] < b[OUT_DATE]) return -1;
    if (a[OUT_DATE] > b[OUT_DATE]) return 1;
    if (a[SHOP_FIELD] < b[SHOP_FIELD]) return -1;
    if (a[SHOP_FIELD] > b[SHOP_FIELD]) return 1;
    if (a[OUT_TITLE] < b[OUT_TITLE]) return -1;
    if (a[OUT_TITLE] > b[OUT_TITLE]) return 1;
    if (a[OUT_DEAL_TYPE] < b[OUT_DEAL_TYPE]) return -1;
    if (a[OUT_DEAL_TYPE] > b[OUT_DEAL_TYPE]) return 1;
    return 0;
  });

  await fse.ensureDir(OUTPUT_DIR);
  const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE_NAME);

  try {
    const names = await fse.readdir(OUTPUT_DIR);
    for (const name of names) {
      if (name === OUTPUT_FILE_NAME || name === BACKUP_FILE_NAME) continue;
      if (name.startsWith("抖店-") && name.toLowerCase().endsWith(".xlsx")) {
        await fse.unlink(path.join(OUTPUT_DIR, name)).catch(() => {});
      }
    }
  } catch {
    // ignore
  }

  const worksheet = XLSX.utils.json_to_sheet(globallyDedupedRows, {
    header: ORDERED_HEADERS
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, OUTPUT_SHEET_NAME);
  XLSX.writeFile(workbook, outputPath);

  console.log(
    `抖店汇总完成（最近 ${daysToExport} 天文件，共 ${globallyDedupedRows.length} 条，多成交类型金额>0，去重 ${allRows.length - globallyDedupedRows.length} 条）: ${outputPath}`
  );

  const expectedDates = [...expectedDateSet].sort();
  const missing = expectedDates.filter((d) => !actualDateSet.has(d));
  if (missing.length > 0) {
    console.error(
      `抖店汇总日期校验失败：最近 ${daysToExport} 天数据缺失。期望日期=${expectedDates.join(", ")}，实际日期=${
        [...actualDateSet].sort().join(", ") || "(空)"
      }，缺失日期=${missing.join(", ")}`
    );
  }

  return { outputPath, rowCount: globallyDedupedRows.length, actualDates: [...actualDateSet].sort(), expectedDates };
}

module.exports = {
  mergeAllShopExportsToData,
  validateShopExportFiles,
  appendDataDateColumn,
  DATA_DATE_COLUMN,
  calcDaysToExport,
  calcExpectedDates,
  OUTPUT_FILE_NAME,
  OUTPUT_SHEET_NAME,
  OUTPUT_DIR,
  ORDERED_HEADERS,
  SOURCE_FIELD,
  SHOP_FIELD,
  OUT_TITLE,
  OUT_DATE,
  OUT_DEAL_TYPE,
  OUT_PAY,
  SOURCE_TAG,
  parsePaymentYuan,
  normalizeTitle
};
