const fs = require("fs/promises");
const path = require("path");
const { fileExists } = require("./fs-utils");
const { clickIfVisible } = require("./login");

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getPostListDateRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const end = yesterday < start ? start : yesterday;
  return { start, end };
}

async function openDateRangePicker(page) {
  const candidates = [
    page.locator("div[role='combobox'][aria-label='Change date']").first(),
    page.locator("div[role='combobox']:has-text('发布时间')").first(),
    page.locator("div:has-text('发布时间 ~')").first()
  ];
  for (const locator of candidates) {
    if (await locator.isVisible({ timeout: 1200 }).catch(() => false)) {
      await locator.click();
      return true;
    }
  }
  return false;
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
      await inputs.nth(1).press("Enter").catch(() => {});
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
  return false;
}

async function applyDateRangeSelection(page, startYmd, endYmd) {
  if (!(await openDateRangePicker(page))) {
    throw new Error("未找到“发布时间”日期范围选择器，请确认页面结构是否变化。");
  }

  await page.waitForTimeout(350);
  const filled = await tryFillRangeInputs(page, startYmd, endYmd);
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

async function readDateRangeDisplayText(page) {
  const candidates = [
    page.locator("div[role='combobox'][aria-label='Change date']").first(),
    page.locator("div[role='combobox']:has-text('发布时间')").first(),
    page.locator("div:has-text('发布时间 ~')").first()
  ];

  for (const locator of candidates) {
    if (await locator.isVisible({ timeout: 600 }).catch(() => false)) {
      const text = await locator.textContent().catch(() => "");
      if (text && text.trim()) {
        return text;
      }
    }
  }
  return "";
}

async function isDateRangeApplied(page, startYmd, endYmd) {
  const displayText = await readDateRangeDisplayText(page);
  const normalized = normalizeDateText(displayText);
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

async function setPostListDateRange(page, accountName) {
  const { start, end } = getPostListDateRange();
  const startYmd = formatYmd(start);
  const endYmd = formatYmd(end);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await applyDateRangeSelection(page, startYmd, endYmd);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
    if (await isDateRangeApplied(page, startYmd, endYmd)) {
      console.log(
        `账号 [${accountName}] 已设置发布时间范围: ${startYmd} ~ ${endYmd}${
          attempt > 1 ? "（重试成功）" : ""
        }`
      );
      return;
    }
    if (attempt < 2) {
      console.warn(
        `账号 [${accountName}] 日期范围校验未通过，准备重试一次: ${startYmd} ~ ${endYmd}`
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
  await fs.writeFile(paths.cookiesPath, JSON.stringify(cookies, null, 2), "utf-8");
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
}

module.exports = { saveAuth, exportPostListData };

