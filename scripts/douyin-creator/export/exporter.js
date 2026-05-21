const path = require("path");
const XLSX = require("xlsx");
const fse = require("fs-extra");
const { clickIfVisible } = require("../core/browser-login");
const { getCreatorExportDateStartSpec } = require("../core/env");

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 解析 "YYYY-MM-DD" / "YYYY/M/D" / "YYYY.M.D" */
function parseFullDateSpec(spec) {
  const s = String(spec || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || year < 1970 || year > 2100) return null;
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

/** 解析 "M.D" / "M-D" / "MM.DD"，日为指定自然年 */
function parseMonthDayInYear(spec, year) {
  const s = String(spec || "").trim();
  if (!s) return null;
  const parts = s.split(/[.\-/]/).filter((x) => x !== "");
  if (parts.length < 2) return null;
  const month = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

function parseCreatorExportStartSpec(spec, now) {
  const raw = String(spec || "").trim();
  if (!raw) return null;

  const full = parseFullDateSpec(raw);
  if (full) return full;

  const currentYear = now.getFullYear();
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1
  );
  const currentYearDate = parseMonthDayInYear(raw, currentYear);
  if (!currentYearDate) return null;
  if (currentYearDate <= yesterday) return currentYearDate;

  const previousYearDate = parseMonthDayInYear(raw, currentYear - 1);
  if (previousYearDate) {
    console.log(
      `[抖创] creatorExportDateStart=${raw} 按上一自然年解析为 ${formatYmd(previousYearDate)}`
    );
    return previousYearDate;
  }
  return currentYearDate;
}

function getPostListDateRange(accountName, options = {}) {
  const now = new Date();
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1
  );

  const defaultStart =
    options.defaultStartDaysAgo != null
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - options.defaultStartDaysAgo)
      : new Date(now.getFullYear(), now.getMonth(), 1);
  const spec = getCreatorExportDateStartSpec(accountName);

  let start;
  if (spec) {
    const parsed = parseCreatorExportStartSpec(spec, now);
    if (parsed) {
      start = parsed;
    } else {
      console.warn(
        `[抖创] creatorExportDateStart 无法解析（${spec}），改用 ${formatYmd(defaultStart)}`
      );
      start = defaultStart;
    }
  } else {
    start = defaultStart;
  }

  let end = yesterday < start ? start : yesterday;

  if (start > end) {
    console.warn(
      `[抖创] 配置的开始日期（${formatYmd(start)}）晚于昨天（${formatYmd(
        yesterday
      )}），改回「${formatYmd(defaultStart)}～昨天」`
    );
    start = defaultStart;
    end = yesterday < start ? start : yesterday;
  }

  return { start, end };
}

function pad2(n) {
  const x = typeof n === "string" ? parseInt(String(n), 10) : n;
  if (!Number.isFinite(x)) return "00";
  return String(x).padStart(2, "0");
}

/**
 * 从筛选条/日期控件附近的文案中提取 YYYY-MM-DD，兼容：
 * - 2026-04-01、2026/4/1、2026.4.1
 * - 2026年4月1日、2026年04月01日
 * - 同月省略年：4月1日（需传 fallbackStartYmd 提供年，月按文案）
 */
function collectYmdsFromDateDisplayText(text, fallbackStartYmd) {
  const raw = String(text || "");
  const set = new Set();

  const tryAdd = (y, mo, d) => {
    const yi = Number(y);
    const mi = Number(mo);
    const di = Number(d);
    if (yi < 1970 || yi > 2100 || mi < 1 || mi > 12 || di < 1 || di > 31) {
      return;
    }
    set.add(`${yi}-${pad2(mi)}-${pad2(di)}`);
  };

  const patterns = [
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g,
    /(\d{4})-(\d{2})-(\d{2})/g,
    /(\d{4})-(\d{1,2})-(\d{1,2})/g,
    /(\d{4})\s*[.\/]\s*(\d{1,2})\s*[.\/]\s*(\d{1,2})/g,
    /(\d{4})\s*[.\-\/年]\s*(\d{1,2})\s*[.\-\/月]\s*(\d{1,2})(?:\s*日)?/g
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(raw)) !== null) {
      tryAdd(m[1], m[2], m[3]);
    }
  }

  if (fallbackStartYmd) {
    const fy = fallbackStartYmd.slice(0, 4);
    const reMd = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
    reMd.lastIndex = 0;
    let m;
    while ((m = reMd.exec(raw)) !== null) {
      tryAdd(fy, m[1], m[2]);
    }

    // 常见：2026-03-01 ~ 04-19 / 2026/3/1～4/19（结束日省略年；短 M-D 用配置年补全）
    const reShortMd = /\b(\d{1,2})[.\-\/](\d{1,2})\b/g;
    reShortMd.lastIndex = 0;
    while ((m = reShortMd.exec(raw)) !== null) {
      tryAdd(fy, m[1], m[2]);
    }
  }

  return set;
}

async function openDateRangePicker(page) {
  const candidates = [
    page.locator("div[role='combobox'][aria-label='Change date']").first(),
    page.locator("div[role='combobox']:has-text('发布时间')").first(),
    page.locator("div:has-text('发布时间 ~')").first(),
    page.locator(".douyin-creator-pc-portal-inner [role='combobox']").first(),
    page.locator("[class*='douyin-creator-pc-datepicker-inset-input']").first(),
    page.locator("[x-type='dateRange']").first()
  ];
  for (const locator of candidates) {
    if (await locator.isVisible({ timeout: 1200 }).catch(() => false)) {
      const alreadyExpanded = await locator
        .getAttribute("aria-expanded", { timeout: 500 })
        .catch(() => null);
      if (alreadyExpanded !== "true") {
        await locator.click({ force: true, timeout: 3000 }).catch(() => {});
      }
      await page
        .locator(".douyin-creator-pc-popover-content, dialog[role='dialog']")
        .first()
        .waitFor({ state: "visible", timeout: 4000 })
        .catch(() => {});
      return true;
    }
  }
  return false;
}

/** 与 input value 对齐，如 2026-3-1 → 2026-03-01 */
function normalizeFlexibleYmd(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (!m) return s;
  return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
}

/**
 * 抖创日期范围弹层：inset 双输入框（placeholder yyyy-MM-dd），一次填准
 * @see .douyin-creator-pc-datepicker-inset-input-wrapper input.douyin-creator-pc-input
 */
async function fillInsetDateRangeInputs(page, startYmd, endYmd) {
  const root = page.locator(
    ".douyin-creator-pc-popover-content, dialog[role='dialog']"
  ).first();
  if (!(await root.isVisible({ timeout: 2500 }).catch(() => false))) {
    return false;
  }

  const inputs = root.locator(
    [
      ".douyin-creator-pc-datepicker-inset-input-wrapper input.douyin-creator-pc-input[type='text']",
      ".douyin-creator-pc-datepicker-inset-input-wrapper input[placeholder*='yyyy']",
      "input[placeholder='yyyy-MM-dd']",
      "input[placeholder*='yyyy']"
    ].join(", ")
  );
  await inputs
    .first()
    .waitFor({ state: "attached", timeout: 3500 })
    .catch(() => {});
  const count = await inputs.count();
  if (count < 2) {
    return false;
  }

  await inputs
    .nth(0)
    .click({ timeout: 2000 })
    .catch(() => {});
  await inputs
    .nth(0)
    .clear({ timeout: 2000 })
    .catch(() => {});
  await inputs.nth(0).fill(startYmd, { timeout: 3000 });
  await inputs
    .nth(1)
    .click({ timeout: 2000 })
    .catch(() => {});
  await inputs
    .nth(1)
    .clear({ timeout: 2000 })
    .catch(() => {});
  await inputs.nth(1).fill(endYmd, { timeout: 3000 });
  await inputs
    .nth(1)
    .press("Enter")
    .catch(() => {});
  await page.waitForTimeout(200);
  return true;
}

async function readInsetDateRangeValues(page) {
  const root = page.locator(
    ".douyin-creator-pc-popover-content, dialog[role='dialog']"
  ).first();
  if (!(await root.isVisible({ timeout: 500 }).catch(() => false))) {
    return null;
  }
  const inputs = root.locator(
    [
      ".douyin-creator-pc-datepicker-inset-input-wrapper input.douyin-creator-pc-input[type='text']",
      ".douyin-creator-pc-datepicker-inset-input-wrapper input[placeholder*='yyyy']",
      "input[placeholder='yyyy-MM-dd']",
      "input[placeholder*='yyyy']"
    ].join(", ")
  );
  if ((await inputs.count()) < 2) {
    return null;
  }
  const a = normalizeFlexibleYmd(
    await inputs
      .nth(0)
      .inputValue({ timeout: 1500 })
      .catch(() => "")
  );
  const b = normalizeFlexibleYmd(
    await inputs
      .nth(1)
      .inputValue({ timeout: 1500 })
      .catch(() => "")
  );
  if (!a || !b) return null;
  return [a, b];
}

async function tryFillRangeInputs(page, startYmd, endYmd) {
  const inputSelectors = [
    "div[role='dialog'] input",
    ".douyin-creator-pc-datepicker-dropdown input",
    ".semi-datepicker-dropdown input",
    "input[placeholder*='开始']",
    "input[placeholder*='结束']"
  ];

  for (const selector of inputSelectors) {
    const inputs = page.locator(selector);
    const count = await inputs.count();
    if (count >= 2) {
      await inputs.nth(0).fill(startYmd);
      await inputs.nth(1).fill(endYmd);
      await inputs
        .nth(1)
        .press("Enter")
        .catch(() => {});
      return true;
    }
  }
  return false;
}

async function clickDateCell(page, ymd) {
  const slash = ymd.replace(/-/g, "/");
  const selectors = [
    `[title='${ymd}']`,
    `[title='${slash}']`,
    `[data-value='${ymd}']`,
    `[aria-label='${ymd}']`,
    `[aria-label='${slash}']`
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 600 }).catch(() => false)) {
      await locator.click();
      return true;
    }
  }

  const dayNum = String(parseInt(ymd.split("-")[2] || "0", 10));
  if (!dayNum || dayNum === "NaN") return false;

  const gridRoots = [
    page.locator(".douyin-creator-pc-popover-content [role='grid']").first(),
    page.locator(".douyin-creator-pc-datepicker-month[role='grid']").first(),
    page
      .locator("[class*='douyin-creator-pc-datepicker'] [role='grid']")
      .first()
  ];
  for (const grid of gridRoots) {
    if (!(await grid.isVisible({ timeout: 500 }).catch(() => false))) continue;
    const cell = grid.getByText(dayNum, { exact: true }).first();
    if (await cell.isVisible({ timeout: 600 }).catch(() => false)) {
      await cell.click();
      return true;
    }
  }
  return false;
}

async function applyDateRangeSelection(page, startYmd, endYmd) {
  if (!(await openDateRangePicker(page))) {
    throw new Error("未找到“发布时间”日期范围选择器，请确认页面结构是否变化。");
  }

  await page.waitForTimeout(250);

  let filled = await fillInsetDateRangeInputs(page, startYmd, endYmd);
  if (!filled) {
    filled = await tryFillRangeInputs(page, startYmd, endYmd);
  }
  if (!filled) {
    const startClicked = await clickDateCell(page, startYmd);
    const endClicked = await clickDateCell(page, endYmd);
    if (!(startClicked && endClicked)) {
      throw new Error(
        `未能设置日期范围（${startYmd} ~ ${endYmd}），请确认日期控件是否可见。`
      );
    }
  }
}

function normalizeDateText(text) {
  return String(text || "")
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/\//g, "-")
    .replace(/\./g, "-")
    .replace(/\s+/g, "");
}

const GATHER_TEXT_MS = 1200;

/** 聚合日期展示文案；短超时，避免 getAttribute/textContent 用默认 30s 卡死 */
async function gatherDateRangeDisplayText(page) {
  const selectors = [
    "div[role='combobox'][aria-label='Change date']",
    "div[role='combobox']:has-text('发布时间')",
    "div:has-text('发布时间 ~')",
    ".douyin-creator-pc-portal-inner div[role='combobox']",
    "[x-type='dateRange']",
    ".douyin-creator-pc-datepicker-inset-input-wrapper",
    "[class*='douyin-creator-pc-datepicker-inset-input']"
  ];

  const chunks = [];
  const seen = new Set();

  const pushChunk = (s, keyPrefix) => {
    const t = String(s || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || t === "-") return;
    const key = `${keyPrefix || ""}:${t.slice(0, 200)}`;
    if (seen.has(key)) return;
    seen.add(key);
    chunks.push(t);
  };

  const t = GATHER_TEXT_MS;
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    const raw = await loc.textContent({ timeout: t }).catch(() => "");
    pushChunk(raw, sel);
    const aria = await loc
      .getAttribute("aria-label", { timeout: t })
      .catch(() => null);
    if (aria) pushChunk(aria, `${sel}:aria`);
  }

  return chunks.join(" ");
}

function legacySubstringRangeMatches(normalized, startYmd, endYmd) {
  const startMd = startYmd.slice(5);
  const endMd = endYmd.slice(5);
  const startSlash = startYmd.replace(/-/g, "/");
  const endSlash = endYmd.replace(/-/g, "/");

  const startMatched =
    normalized.includes(startYmd) ||
    normalized.includes(normalizeDateText(startSlash)) ||
    normalized.includes(startMd);
  const endMatched =
    normalized.includes(endYmd) ||
    normalized.includes(normalizeDateText(endSlash)) ||
    normalized.includes(endMd);

  return startMatched && endMatched;
}

async function isDateRangeApplied(page, startYmd, endYmd) {
  const inset = await readInsetDateRangeValues(page);
  if (inset && inset[0] === startYmd && inset[1] === endYmd) {
    return true;
  }

  const displayText = await gatherDateRangeDisplayText(page);
  const ymds = collectYmdsFromDateDisplayText(displayText, startYmd);
  if (ymds.has(startYmd) && ymds.has(endYmd)) {
    return true;
  }

  const normalized = normalizeDateText(displayText);
  if (legacySubstringRangeMatches(normalized, startYmd, endYmd)) {
    return true;
  }

  return false;
}

async function setPostListDateRange(page, accountName, options = {}) {
  let start;
  let end;
  let startYmd;
  let endYmd;
  if (options.startDate && options.endDate) {
    startYmd = options.startDate;
    endYmd = options.endDate;
    start = parseFullDateSpec(startYmd) || new Date();
    end = parseFullDateSpec(endYmd) || new Date();
  } else {
    const range = getPostListDateRange(accountName, options);
    start = range.start;
    end = range.end;
    startYmd = formatYmd(start);
    endYmd = formatYmd(end);
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await applyDateRangeSelection(page, startYmd, endYmd);

    let ok = false;
    const insetPair = await readInsetDateRangeValues(page);
    if (insetPair && insetPair[0] === startYmd && insetPair[1] === endYmd) {
      ok = true;
    }

    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(600);
    if (!ok) {
      ok = await isDateRangeApplied(page, startYmd, endYmd);
    }
    if (ok) {
      console.log(
        `账号 [${accountName}] 已设置发布时间范围: ${startYmd} ~ ${endYmd}${
          attempt > 1 ? "（重试成功）" : ""
        }`
      );
      return { start, end, startYmd, endYmd };
    }

    if (attempt < 2) {
      const dbg = (await gatherDateRangeDisplayText(page)).slice(0, 180);
      console.warn(
        `账号 [${accountName}] 日期范围校验未通过，准备重试一次: ${startYmd} ~ ${endYmd}` +
          (dbg ? ` | 页面采集: ${dbg}` : "")
      );
      await page.waitForTimeout(350);
    }
  }

  throw new Error(
    `已重试仍未通过日期范围校验（${startYmd} ~ ${endYmd}），请确认日期控件展示文本是否变化。`
  );
}

function parsePublishDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const text = String(value || "").trim();
  if (!text) return null;
  const m = text.match(/(\d{4})[年.\-/](\d{1,2})[月.\-/](\d{1,2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }
  const normalized = text
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/\//g, "-")
    .replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function detectPublishTimeField(headers) {
  const candidates = ["发布时间", "发布时间（北京时间）", "发布时间(北京时间)"];
  for (const candidate of candidates) {
    if (headers.includes(candidate)) return candidate;
  }
  return headers.find((name) => /发布时间/.test(name)) || null;
}

function validateExportedPostListXlsx(filePath, accountName, start, end) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error(`账号 [${accountName}] 导出文件没有可读取的 sheet: ${filePath}`);
  }
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: "",
    raw: false
  });
  if (!rows.length) {
    throw new Error(`账号 [${accountName}] 导出文件为空: ${filePath}`);
  }

  const headers = Object.keys(rows[0] || {});
  const publishField = detectPublishTimeField(headers);
  if (!publishField) {
    throw new Error(
      `账号 [${accountName}] 导出文件缺少发布时间列，无法校验日期范围: ${filePath}`
    );
  }

  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);

  let checked = 0;
  const outOfRange = [];
  const unparsed = [];
  rows.forEach((row, index) => {
    const raw = row[publishField];
    const d = parsePublishDateValue(raw);
    if (!d) {
      unparsed.push({ rowNumber: index + 2, value: raw });
      return;
    }
    checked += 1;
    if (d < startDay || d > endDay) {
      outOfRange.push({ rowNumber: index + 2, value: raw, date: formatYmd(d) });
    }
  });

  if (checked === 0) {
    throw new Error(
      `账号 [${accountName}] 导出文件发布时间列全部无法解析，无法校验日期范围: ${filePath}`
    );
  }
  if (unparsed.length > 0) {
    const sample = unparsed
      .slice(0, 5)
      .map((item) => `第${item.rowNumber}行=${item.value || "(空)"}`)
      .join("；");
    throw new Error(
      `账号 [${accountName}] 导出文件存在无法解析的发布时间（${unparsed.length} 行）：${sample}`
    );
  }
  if (outOfRange.length > 0) {
    const sample = outOfRange
      .slice(0, 5)
      .map((item) => `第${item.rowNumber}行=${item.value}→${item.date}`)
      .join("；");
    throw new Error(
      `账号 [${accountName}] 导出文件日期超出预期范围 ${formatYmd(startDay)} ~ ${formatYmd(endDay)}（${outOfRange.length} 行）：${sample}`
    );
  }

  console.log(
    `账号 [${accountName}] 导出文件日期校验通过: ${formatYmd(startDay)} ~ ${formatYmd(endDay)}，有效行 ${checked}`
  );
}

async function saveAuth(context, paths, accountName, options = {}) {
  const cookies = await context.cookies();
  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error("浏览器上下文无 cookie，跳过保存登录态");
  }
  await context.storageState({ path: paths.storageStatePath });
  await fse.writeFile(
    paths.cookiesPath,
    JSON.stringify(cookies, null, 2),
    "utf-8"
  );
  const verifiedDetail = options.verifiedDetail || "登录态已保存";
  try {
    await fse.writeFile(
      path.join(paths.accountDir, "verified-at.json"),
      JSON.stringify(
        {
          time: Date.now(),
          detail: verifiedDetail,
          verified: true,
          status: "valid"
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch {
    // 忽略 verified-at 写入失败
  }
  console.log(`账号 [${accountName}] 登录态已保存:`);
  console.log(`- storageState: ${paths.storageStatePath}`);
  console.log(`- cookies: ${paths.cookiesPath}`);
  console.log(`- cookie 数量: ${cookies.length}`);
}

async function cleanupOldExportFiles(dataDir, keepFileName) {
  try {
    const names = await fse.readdir(dataDir);
    for (const name of names) {
      if (name === keepFileName) continue;
      if (!name.toLowerCase().endsWith(".xlsx")) continue;
      await fse.unlink(path.join(dataDir, name)).catch(() => {});
    }
  } catch {
    // ignore cleanup failure
  }
}

async function exportPostListData(page, paths, accountName) {
  const tabClicked =
    (await clickIfVisible(page.getByRole("radio", { name: "投稿列表" }), 2500)) ||
    (await clickIfVisible(page.getByRole("tab", { name: "投稿列表" }), 2500)) ||
    (await clickIfVisible(page.getByText("投稿列表"), 2500));

  if (!tabClicked) {
    throw new Error("未找到“投稿列表”标签，请确认页面结构是否变化。");
  }

  await page.waitForTimeout(800);
  const dateRange = await setPostListDateRange(page, accountName);

  let exportBtn = page.getByRole("button", { name: /导出/ }).first();
  const roleBtnVisible = await exportBtn
    .isVisible({ timeout: 2500 })
    .catch(() => false);
  if (!roleBtnVisible) {
    exportBtn = page.locator("button:has-text('导出数据')").first();
  }

  if (!(await exportBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error("未找到“导出”按钮，请确认账号权限或页面加载状态。");
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await exportBtn.click();
  const download = await downloadPromise;

  const rawName =
    download.suggestedFilename() || `douyin-content-${Date.now()}.xlsx`;
  const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_");
  const tempFileName = `latest-${Date.now()}-${safeName}`;
  const tempPath = path.join(paths.dataDir, tempFileName);
  const latestFileName = safeName;
  const savePath = path.join(paths.dataDir, latestFileName);
  await download.saveAs(tempPath);

  if (!(await fse.pathExists(tempPath))) {
    console.log(`账号 [${accountName}] 提示：文件已触发下载，但未检测到落盘。`);
  }

  validateExportedPostListXlsx(tempPath, accountName, dateRange.start, dateRange.end);
  await fse.rename(tempPath, savePath).catch(async () => {
    await fse.unlink(savePath).catch(() => {});
    await fse.rename(tempPath, savePath);
  });
  await cleanupOldExportFiles(paths.dataDir, latestFileName);

  console.log(`账号 [${accountName}] 导出成功:`);
  console.log(`- 文件路径: ${savePath}`);
  return savePath;
}

module.exports = { saveAuth, exportPostListData, setPostListDateRange };
