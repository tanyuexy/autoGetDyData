const path = require("path");
const XLSX = require("xlsx");
const fse = require("fs-extra");

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
/** 汇总表固定文件名，每次覆盖，避免 data 下堆积多份 */
const OUTPUT_FILE_NAME = "抖创-全部店铺-作品列表.xlsx";
const PARTIAL_OUTPUT_FILE_SUFFIX = "抖创-部分店铺-作品列表.xlsx";
const OUTPUT_SHEET_NAME = "全部作品";
const SOURCE_FIELD_NAME = "数据来源";
const SOURCE_TAG = "抖创";
const SHOP_FIELD_NAME = "所属店铺";
const PUBLISH_TIME_CANDIDATES = ["发布时间", "发布时间（北京时间）", "发布时间(北京时间)"];

/** 汇总表写入前：作品标题列去掉所有空白（含空格、制表、全角空格等） */
const WORK_TITLE_HEADER_NAMES = new Set(["作品名称", "作品名"]);

function stripAllWhitespaceText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s/g, "");
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
    [SOURCE_FIELD_NAME]: SOURCE_TAG,
    [SHOP_FIELD_NAME]: accountName,
    ...Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, normalizeCellValue(v)])
    )
  }));

  return { headers, rows: enrichedRows };
}

function makeTimestampForFileName() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
}

async function mergeExportFiles(accountResults, options = {}) {
  const requireAllSuccess = Boolean(options.requireAllSuccess);
  const failed = accountResults.filter((item) => !item || !item.ok);
  const isPartial = failed.length > 0;
  const succeeded = accountResults.filter(
    (item) => item && item.ok && item.exportFilePath
  );
  if (succeeded.length === 0) {
    console.log("未发现可汇总的导出文件，跳过生成总表。");
    return null;
  }

  if (requireAllSuccess && isPartial) {
    throw new Error(
      `存在失败账号（${failed.length} 个），已拒绝生成可同步到飞书的抖创固定总表。`
    );
  }

  const allRows = [];
  const unionHeaders = new Set();
  unionHeaders.add(SOURCE_FIELD_NAME);
  unionHeaders.add(SHOP_FIELD_NAME);

  for (const item of succeeded) {
    const { headers, rows } = readAccountExportRows(
      item.exportFilePath,
      item.accountName
    );
    for (const h of headers) {
      if (h !== SHOP_FIELD_NAME && h !== SOURCE_FIELD_NAME) {
        unionHeaders.add(h);
      }
    }
    allRows.push(...rows);
  }

  const orderedHeaders = [...unionHeaders];
  const normalizedRows = allRows.map((row) => {
    const normalized = {};
    for (const header of orderedHeaders) {
      let cell = normalizeCellValue(row[header]);
      if (WORK_TITLE_HEADER_NAMES.has(header)) {
        cell = stripAllWhitespaceText(cell);
      }
      normalized[header] = cell;
    }
    return normalized;
  });

  const worksheet = XLSX.utils.json_to_sheet(normalizedRows, {
    header: orderedHeaders
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, OUTPUT_SHEET_NAME);

  await fse.ensureDir(OUTPUT_DIR);
  const outputFileName = isPartial
    ? `部分-${makeTimestampForFileName()}-${PARTIAL_OUTPUT_FILE_SUFFIX}`
    : OUTPUT_FILE_NAME;
  const outputPath = path.join(OUTPUT_DIR, outputFileName);

  try {
    const names = await fse.readdir(OUTPUT_DIR);
    const suffix = "-全部店铺-作品列表.xlsx";
    for (const name of names) {
      if (name === outputFileName) continue;
      if (!isPartial && name.endsWith(suffix)) {
        await fse.unlink(path.join(OUTPUT_DIR, name)).catch(() => {});
      }
    }
  } catch {
    // 忽略清理失败（如无权限）
  }

  XLSX.writeFile(workbook, outputPath);
  if (isPartial) {
    console.warn(
      `存在失败账号（${failed.length} 个），已生成部分汇总文件，不覆盖固定总表: ${outputPath}`
    );
  } else {
    console.log(`汇总完成（已覆盖为唯一抖创总表）: ${outputPath}`);
  }
  return outputPath;
}

module.exports = {
  mergeExportFiles
};
