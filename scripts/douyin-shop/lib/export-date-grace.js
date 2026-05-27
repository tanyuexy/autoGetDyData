const { getShopExportDebugTimeParts } = require("./debug");

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

function shanghaiCalendarDate(date = new Date()) {
  const parts = getShopExportDebugTimeParts(date);
  return `${parts.year}/${parts.month}/${parts.day}`;
}

/** 今日、昨日（Asia/Shanghai）：抖店常未产出，缺失时仅告警 */
function getGracefulMissingDateSet() {
  const today = shanghaiCalendarDate(new Date());
  const parts = getShopExportDebugTimeParts(new Date());
  const anchor = new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    12,
    0,
    0,
    0
  );
  anchor.setDate(anchor.getDate() - 1);
  const yesterday = shanghaiCalendarDate(anchor);
  return new Set([today, yesterday]);
}

function isCalendarUnavailableError(message) {
  const msg = String(message || "");
  return /在日历中不可选/.test(msg) || /数据可能未产出/.test(msg);
}

function filterHardMissingDates(missingDates, gracefulSet = getGracefulMissingDateSet()) {
  return (missingDates || []).filter((d) => !gracefulSet.has(normalizeDateYMD(d)));
}

function calcExpectedDatesFromDays(daysToExport) {
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

function buildExpectedExportDates(options = {}) {
  const targetDates = Array.isArray(options.targetDates) ? options.targetDates : null;
  if (targetDates && targetDates.length > 0) {
    const dates = [
      ...new Set(targetDates.map((d) => normalizeDateYMD(d)).filter(Boolean))
    ];
    dates.sort();
    return dates;
  }
  return calcExpectedDatesFromDays(options.daysToExport);
}

function countRequiredExportDays(expectedDates, gracefulSet = getGracefulMissingDateSet()) {
  return (expectedDates || []).filter((d) => !gracefulSet.has(normalizeDateYMD(d))).length;
}

module.exports = {
  normalizeDateYMD,
  getGracefulMissingDateSet,
  isCalendarUnavailableError,
  filterHardMissingDates,
  buildExpectedExportDates,
  countRequiredExportDays,
  calcExpectedDatesFromDays
};
