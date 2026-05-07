const path = require("path");
const fs = require("fs/promises");
const { existsSync } = require("fs");
const { execSync } = require("child_process");
const XLSX = require("xlsx");

function resolveExportsDir() {
  const envVal = process.env.EXPORTS_DIR;
  if (envVal) return path.resolve(process.cwd(), envVal);
  const newPath = path.resolve(process.cwd(), "storage/exports");
  const oldPath = path.resolve(process.cwd(), "data");
  if (existsSync(oldPath) && !existsSync(newPath)) return oldPath;
  return newPath;
}
const BACKUP_FILE = path.join(resolveExportsDir(), "抖店-飞书表备份.xlsx");

/**
 * 读取飞书备份表，找到「日期」列的最大值。
 * @returns {Promise<Date|null>}
 */
async function readBackupMaxDate() {
  let stat;
  try {
    stat = await fs.stat(BACKUP_FILE);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const wb = XLSX.readFile(BACKUP_FILE, { cellDates: true, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

  let maxDate = null;
  for (const row of rows) {
    const raw = row["日期"];
    if (raw === undefined || raw === null) continue;
    let d = null;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      // 飞书 timestamp
      const ms = raw > 1e15 ? raw / 1000 : raw;
      d = new Date(ms);
    } else {
      const s = String(raw).trim();
      if (!s) continue;
      const m = s.match(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
      if (m) {
        d = new Date(+m[1], +m[2] - 1, +m[3]);
      } else {
        d = new Date(s.replace(/\//g, "-"));
      }
    }
    if (d && !isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      if (!maxDate || d > maxDate) maxDate = d;
    }
  }
  return maxDate;
}

/**
 * 如果备份表不存在则先执行备份操作。
 */
async function ensureBackupExists() {
  try {
    await fs.stat(BACKUP_FILE);
    return;
  } catch {
    console.log("未找到飞书备份表（抖店-飞书表备份.xlsx），先执行备份…");
    execSync("node scripts/run.js feishu:backup --profiles shop", {
      stdio: "inherit",
      cwd: process.cwd()
    });
    console.log("备份完成。");
  }
}

/**
 * 读取备份表最后一日期，计算需要导出的天数。
 * 抖店/罗盘最新只提供到昨天的数据；如果备份最新日期已经是昨天或更晚，
 * 仍导出昨天 1 天，用于刷新 T+1 已更新的数据。
 * @returns {Promise<number>} 需要导出的天数（至少 1 天）
 */
async function calcDaysToExport() {
  await ensureBackupExists();

  const maxDate = await readBackupMaxDate();
  if (!maxDate) {
    console.log("备份表中未找到有效日期，默认导出最近 1 天");
    return 1;
  }

  // 结束日期 = 昨天（T+1 数据已更新）
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  if (maxDate >= yesterday) {
    console.log(
      `备份表最后日期: ${fmtDate(maxDate)}，已覆盖到最新可导出的昨日数据，` +
      `本次仍刷新导出昨天 ${fmtDate(yesterday)} 1 天数据`
    );
    return 1;
  }

  // 从备份最后日期的后一天开始，补到昨天
  const startDate = new Date(maxDate);
  startDate.setDate(startDate.getDate() + 1);

  const diffMs = yesterday.getTime() - startDate.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;

  console.log(
    `备份表最后日期: ${fmtDate(maxDate)}，从 ${fmtDate(startDate)} 开始导出，` +
    `昨天为 ${fmtDate(yesterday)}，共需导出 ${days} 天数据`
  );
  return days;
}

function fmtDate(d) {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

module.exports = { calcDaysToExport };
