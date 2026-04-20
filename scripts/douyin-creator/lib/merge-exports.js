const path = require("path");
const XLSX = require("xlsx");
const { ensureDir } = require("./fs-utils");

const OUTPUT_DIR = path.resolve(process.cwd(), "data");
const OUTPUT_SHEET_NAME = "全部作品";
const SHOP_FIELD_NAME = "所属店铺";
const PUBLISH_TIME_CANDIDATES = ["发布时间", "发布时间（北京时间）", "发布时间(北京时间)"];

function timestampForFileName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function normalizeCellValue(value) {
  if (value === undefined || value === null) return "";
  return value;
}

function toTimeNumber(value) {
  if (value instanceof Date) return value.getTime();
  const text = String(value || "").trim();
  if (!text) return Number.POSITIVE_INFINITY;
  const normalized = text.replace(/\//g, "-");
  const t = Date.parse(normalized);
  if (Number.isFinite(t)) return t;
  return Number.POSITIVE_INFINITY;
}

function detectPublishTimeField(headers) {
  for (const candidate of PUBLISH_TIME_CANDIDATES) {
    if (headers.includes(candidate)) return candidate;
  }
  return headers.find((name) => /发布时间/.test(name)) || null;
}

function sortRecordsByPublishTime(records, publishFieldName) {
  if (!publishFieldName) return records;
  return [...records].sort((a, b) => {
    const ta = toTimeNumber(a[publishFieldName]);
    const tb = toTimeNumber(b[publishFieldName]);
    if (ta === tb) return 0;
    return ta - tb;
  });
}

function readAccountExportRows(exportFilePath, accountName) {
  const workbook = XLSX.readFile(exportFilePath, { cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { headers: [], rows: [] };
  }
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
    raw: false
  });
  if (!rows.length) {
    return { headers: [], rows: [] };
  }

  const headers = Object.keys(rows[0]);
  const publishFieldName = detectPublishTimeField(headers);
  const sortedRows = sortRecordsByPublishTime(rows, publishFieldName);
  const enrichedRows = sortedRows.map((row) => ({
    [SHOP_FIELD_NAME]: accountName,
    ...Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, normalizeCellValue(v)])
    )
  }));

  return { headers, rows: enrichedRows };
}

async function mergeExportFiles(accountResults) {
  const succeeded = accountResults.filter(
    (item) => item && item.ok && item.exportFilePath
  );
  if (succeeded.length === 0) {
    console.log("未发现可汇总的导出文件，跳过生成总表。");
    return null;
  }

  const allRows = [];
  const unionHeaders = new Set();
  unionHeaders.add(SHOP_FIELD_NAME);

  for (const item of succeeded) {
    const { headers, rows } = readAccountExportRows(
      item.exportFilePath,
      item.accountName
    );
    for (const h of headers) {
      if (h !== SHOP_FIELD_NAME) unionHeaders.add(h);
    }
    allRows.push(...rows);
  }

  const orderedHeaders = [...unionHeaders];
  const normalizedRows = allRows.map((row) => {
    const normalized = {};
    for (const header of orderedHeaders) {
      normalized[header] = normalizeCellValue(row[header]);
    }
    return normalized;
  });

  const worksheet = XLSX.utils.json_to_sheet(normalizedRows, {
    header: orderedHeaders
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, OUTPUT_SHEET_NAME);

  await ensureDir(OUTPUT_DIR);
  const outputPath = path.join(
    OUTPUT_DIR,
    `${timestampForFileName()}-全部店铺-作品列表.xlsx`
  );
  XLSX.writeFile(workbook, outputPath);
  console.log(`汇总完成: ${outputPath}`);
  return outputPath;
}

module.exports = {
  mergeExportFiles
};
