const fs = require("fs/promises");
const path = require("path");
const { fileExists } = require("./fs-utils");
const { clickIfVisible } = require("./login");
const { getCreatorExportDateStartSpec } = require("./env");

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 解析 "M.D" / "M-D" / "MM.DD"，日为当前自然年 */
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

function getPostListDateRange(accountName) {
  const now = new Date();
  const year = now.getFullYear();
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1
  );

  const defaultMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const spec = getCreatorExportDateStartSpec(accountName);

  let start;
  if (spec) {
    const parsed = parseMonthDayInYear(spec, year);
    if (parsed) {
      start = parsed;
    } else {
      console.warn(
        `[抖创] creatorExportDateStart 无法解析（${spec}），改用本月一日`
      );
      start = defaultMonthStart;
    }
  } else {
    start = defaultMonthStart;
  }

  let end = yesterday < start ? start : yesterday;

  if (start > end) {
    console.warn(
      `[抖创] 配置的开始日期（${formatYmd(start)}）晚于昨天（${formatYmd(
        yesterday
      )}），改回「本月一日～昨天」`
    );
    start = defaultMonthStart;
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
      await locator.click();
      await page
        .locator(".douyin-creator-pc-popover-content")
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
  const root = page.locator(".douyin-creator-pc-popover-content").first();
  if (!(await root.isVisible({ timeout: 2500 }).catch(() => false))) {
    return false;
  }

  const inputs = root.locator(
    ".douyin-creator-pc-datepicker-inset-input-wrapper input.douyin-creator-pc-input[type='text'], .douyin-creator-pc-datepicker-inset-input-wrapper input[placeholder*='yyyy']"
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
  const root = page.locator(".douyin-creator-pc-popover-content").first();
  if (!(await root.isVisible({ timeout: 500 }).catch(() => false))) {
    return null;
  }
  const inputs = root.locator(
    ".douyin-creator-pc-datepicker-inset-input-wrapper input.douyin-creator-pc-input[type='text'], .douyin-creator-pc-datepicker-inset-input-wrapper input[placeholder*='yyyy']"
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

async function setPostListDateRange(page, accountName) {
  const { start, end } = getPostListDateRange(accountName);
  const startYmd = formatYmd(start);
  const endYmd = formatYmd(end);

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
      return;
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

async function saveAuth(context, paths, accountName) {
  const cookies = await context.cookies();
  await context.storageState({ path: paths.storageStatePath });
  await fs.writeFile(
    paths.cookiesPath,
    JSON.stringify(cookies, null, 2),
    "utf-8"
  );
  console.log(`账号 [${accountName}] 登录态已保存:`);
  console.log(`- storageState: ${paths.storageStatePath}`);
  console.log(`- cookies: ${paths.cookiesPath}`);
  console.log(`- cookie 数量: ${cookies.length}`);
}

async function exportPostListData(page, paths, accountName) {
  const tabClicked =
    (await clickIfVisible(page.getByRole("tab", { name: "投稿列表" }), 2500)) ||
    (await clickIfVisible(page.getByText("投稿列表"), 2500));

  if (!tabClicked) {
    throw new Error("未找到“投稿列表”标签，请确认页面结构是否变化。");
  }

  await page.waitForTimeout(800);
  await setPostListDateRange(page, accountName);

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
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const savePath = path.join(paths.dataDir, `${timestamp}-${safeName}`);
  await download.saveAs(savePath);

  if (!(await fileExists(savePath))) {
    console.log(`账号 [${accountName}] 提示：文件已触发下载，但未检测到落盘。`);
  }

  console.log(`账号 [${accountName}] 导出成功:`);
  console.log(`- 文件路径: ${savePath}`);
  return savePath;
}

module.exports = { saveAuth, exportPostListData };
