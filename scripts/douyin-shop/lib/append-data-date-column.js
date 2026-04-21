const XLSX = require("xlsx");

/** 与 merge-shop-exports 中字段名一致 */
const DATA_DATE_COLUMN = "数据日期";

/**
 * 在已下载的表格首行表头后追加（或填充）「数据日期」列，格式如 2026/04/19。
 * 支持 xlsx；若为 csv 则用 xlsx 读入再写回 xlsx 同路径可能不合适——罗盘多为 xlsx。
 *
 * @param {string} filePath 本地文件绝对路径
 * @param {string | null | undefined} dataDate 可为空则跳过
 */
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

module.exports = { appendDataDateColumn, DATA_DATE_COLUMN };
