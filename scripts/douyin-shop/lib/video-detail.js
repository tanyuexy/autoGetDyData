const path = require("path");
const fs = require("fs/promises");

const {
  pickLatestSelectableCalendarDay
} = require("./pick-latest-calendar-day");
const { appendDataDateColumn } = require("./append-data-date-column");

const VIDEO_SELF_URL =
  process.env.SHOP_VIDEO_SELF_URL ||
  "https://compass.jinritemai.com/shop/video/self";

function logStep(tag, msg, started) {
  const dur = started ? ` (+${Date.now() - started}ms)` : "";
  console.log(`[${tag}] ${msg}${dur}`);
}

function logWarn(tag, msg) {
  console.warn(`[${tag}] ${msg}`);
}

async function waitForVideoSelfReady(page, tag, timeoutMs = 20000) {
  const started = Date.now();
  await Promise.race([
    page
      .locator("text=短视频明细")
      .first()
      .waitFor({ state: "visible", timeout: timeoutMs })
      .catch(() => null),
    page
      .locator("text=视频明细")
      .first()
      .waitFor({ state: "visible", timeout: timeoutMs })
      .catch(() => null)
  ]);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hasMore = await page
      .locator('label.ecom-radio-button-wrapper:has-text("更多")')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    const hasAdTab = await page
      .locator('div[role="tab"]:has-text("非投放")')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (hasMore && hasAdTab) {
      logStep(tag, "视频明细页筛选区已就绪", started);
      return { ok: true };
    }
    await page.waitForTimeout(300);
  }
  logWarn(tag, `视频明细页筛选区 ${timeoutMs}ms 内未全部就绪`);
  return { ok: false, failure: `视频明细页筛选区 ${timeoutMs}ms 内未就绪` };
}

async function gotoVideoSelf(page, tag) {
  const started = Date.now();
  const url = page.url() || "";
  if (!url.startsWith(VIDEO_SELF_URL)) {
    logStep(tag, `跳转至短视频明细页: ${VIDEO_SELF_URL}`);
    try {
      await page.goto(VIDEO_SELF_URL, {
        waitUntil: "domcontentloaded",
        timeout: 20000
      });
    } catch (error) {
      logWarn(tag, `跳转短视频明细页失败: ${error.message || error}`);
      throw error;
    }
  } else {
    logStep(tag, `当前已在短视频明细页`);
  }

  await waitForVideoSelfReady(page, tag, 25000);
  logStep(tag, `gotoVideoSelf 完成`, started);
}

/**
 * 视频明细：悬浮「更多」→ 左侧选「自然日」→ 日历里点「当前可选的最后一个自然日 - dayOffset」
 * dayOffset=0 最新一天，dayOffset=1 前一天，以此类推。
 * 适用于需要回溯导出多天数据的场景。
 *
 * @returns {Promise<{ ok: boolean, dataDate: string | null, failures: Array<{ step: string, message: string }> }>}
 */
async function selectDateRangeYesterday(page, tag, dayOffset = 0) {
  const started = Date.now();
  const failures = [];

  const moreTrigger = page
    .locator(
      'label.ecom-radio-button-wrapper.ecom-dropdown-trigger:has-text("更多"), label.ecom-radio-button-wrapper:has-text("更多")'
    )
    .first();
  const moreVisible = await moreTrigger
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!moreVisible) {
    failures.push({ step: '视频-「更多」按钮', message: '未找到「更多」按钮' });
    return { ok: false, dataDate: null, failures };
  }

  let dropdownVisible = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await moreTrigger.hover({ timeout: 1500 });
    } catch (e) {
      if (attempt === 2) {
        failures.push({ step: '视频-「更多」hover', message: `hover「更多」失败: ${e.message || e}` });
      }
      continue;
    }
    await page.waitForTimeout(350);
    dropdownVisible = await page
      .locator(".ecom-dorami-date-picker-quick-picker-dropdown")
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (dropdownVisible) break;
    if (attempt === 2) {
      failures.push({ step: '视频-「更多」弹层', message: 'hover「更多」3 次后弹层仍未出现' });
    }
  }

  if (!dropdownVisible) {
    return { ok: false, dataDate: null, failures };
  }

  const dropdown = page
    .locator(".ecom-dorami-date-picker-quick-picker-dropdown")
    .first();

  let naturalDay = dropdown
    .locator('li.ecom-menu-item:has-text("自然日")')
    .first();
  if (!(await naturalDay.isVisible({ timeout: 500 }).catch(() => false))) {
    naturalDay = dropdown
      .locator('span.ecom-menu-title-content:has-text("自然日")')
      .first();
  }
  if (!(await naturalDay.isVisible({ timeout: 500 }).catch(() => false))) {
    naturalDay = page.locator(':text-is("自然日")').first();
  }

  let naturalDayClicked = false;
  if (await naturalDay.isVisible({ timeout: 1500 }).catch(() => false)) {
    try {
      await naturalDay.hover({ timeout: 1000 });
      await naturalDay.click({ timeout: 2000 });
      naturalDayClicked = true;
      await page.waitForTimeout(400);
      logStep(tag, '已点击"自然日"分类');
    } catch (e) {
      failures.push({ step: '视频-「自然日」选项', message: `点击「自然日」失败: ${e.message || e}` });
    }
  } else {
    failures.push({ step: '视频-「自然日」选项', message: '悬浮「更多」后仍未找到「自然日」选项' });
  }

  const rightPanel = page
    .locator(
      ".ecom-dorami-date-picker-right-container, .ecom-picker-panel-container"
    )
    .first();
  const scope = (await rightPanel
    .isVisible({ timeout: 500 })
    .catch(() => false))
    ? rightPanel
    : page;

  const pickResult = await pickLatestSelectableCalendarDay(page, scope, dayOffset);
  if (pickResult.failures) failures.push(...pickResult.failures);

  const clicked = Boolean(pickResult.ok);
  const dataDate = pickResult.dataDate || null;
  if (clicked) {
    logStep(tag, `已选择日历第${dayOffset + 1}个可选自然日`);
    if (dataDate) {
      logStep(tag, `解析到的数据日期: ${dataDate}`);
    }
  } else {
    if (!pickResult.failures || pickResult.failures.length === 0) {
      failures.push({ step: '视频-日历选择', message: '日历中未找到可点击的日期格' });
    }
  }

  await page.waitForTimeout(400);
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.move(10, 10).catch(() => {});
  await page.waitForTimeout(300);

  logStep(tag, `selectDateRangeYesterday(offset=${dayOffset}) ${clicked ? "成功" : "失败"}`, started);
  return { ok: clicked, dataDate, failures };
}

async function ensureVideoDetailTab(page, tag) {
  const started = Date.now();
  const failures = [];
  const tabSel = 'div[role="tab"]:has-text("视频明细"), :text-is("视频明细")';
  let tab = page.locator(tabSel).first();
  const visible1 = await tab.isVisible({ timeout: 2000 }).catch(() => false);
  if (!visible1) {
    await page.mouse.wheel(0, 900).catch(() => {});
    await page.waitForTimeout(300);
    tab = page.locator(tabSel).first();
    const visible2 = await tab.isVisible({ timeout: 1500 }).catch(() => false);
    if (!visible2) {
      failures.push({ step: '视频-「视频明细」Tab', message: '未找到「视频明细」Tab' });
      return { ok: false, failures };
    }
  }
  const selected = await tab.getAttribute("aria-selected").catch(() => null);
  if (selected === "true") {
    logStep(tag, '"视频明细" Tab 已选中', started);
    return { ok: true, failures };
  }
  try {
    await tab.scrollIntoViewIfNeeded();
    await tab.click({ timeout: 2000 });
    await page.waitForTimeout(600);
    logStep(tag, '已切换到"视频明细" Tab', started);
    return { ok: true, failures };
  } catch (e) {
    failures.push({ step: '视频-「视频明细」Tab', message: `点击Tab失败: ${e.message || e}` });
    return { ok: false, failures };
  }
}

async function selectNonAdTab(page, tag) {
  const started = Date.now();
  const failures = [];
  let targetTab = page.locator('#_auto__ad_type div[role="tab"]:has-text("非投放")').first();
  const viaContainer = await targetTab
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (!viaContainer) {
    targetTab = page
      .locator('div[role="tab"]:has-text("非投放")')
      .first();
    const byText = await targetTab
      .waitFor({ state: "visible", timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!byText) {
      failures.push({ step: '视频-「非投放」Tab', message: '未找到「非投放」Tab' });
      return { ok: false, failures };
    }
  }

  const selected = await targetTab.getAttribute("aria-selected").catch(() => null);
  if (selected === "true") {
    logStep(tag, '投放属性已为"非投放"，跳过切换', started);
    return { ok: true, failures };
  }

  try {
    await targetTab.click({ timeout: 3000 });
  } catch (e) {
    failures.push({ step: '视频-「非投放」Tab', message: `点击失败: ${e.message || e}` });
    return { ok: false, failures };
  }
  await page.waitForTimeout(600);
  const ok = await page
    .locator('div[role="tab"][aria-selected="true"]:has-text("非投放")')
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (ok) {
    logStep(tag, '已将投放属性切换为"非投放"', started);
  } else {
    failures.push({ step: '视频-「非投放」Tab', message: '点击后未观察到 aria-selected=true 切换' });
  }
  return { ok, failures };
}

function safeShopDirName(name) {
  return String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ");
}

async function clickDownloadAndSave(page, tag, saveDir, options = {}) {
  const exportLabel = options.exportLabel || "视频明细";
  const started = Date.now();
  await fs.mkdir(saveDir, { recursive: true });

  const allButtons = page.locator('button:has-text("下载明细")');
  const btnCount = await allButtons.count().catch(() => 0);
  if (btnCount === 0) {
    throw new Error('页面上未找到"下载明细"按钮');
  }
  const downloadBtn = allButtons.nth(btnCount - 1);
  await downloadBtn.waitFor({ state: "visible", timeout: 8000 });

  logStep(tag, `发现 ${btnCount} 个"下载明细"按钮，点击最后一个（${exportLabel}）`);
  const downloadPromise = page.waitForEvent("download", { timeout: 60000 });

  await downloadBtn.click({ timeout: 3000 });

  let download;
  try {
    download = await downloadPromise;
  } catch (error) {
    throw new Error(
      `点击"下载明细"后 60s 内未触发下载事件：${error.message || error}`
    );
  }

  const rawName =
    download.suggestedFilename() || `video-detail-${Date.now()}.csv`;
  const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_");
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const savePath = path.join(saveDir, `${ts}-${exportLabel}-${safeName}`);

  await download.saveAs(savePath);
  logStep(tag, `明细文件已保存: ${savePath}`, started);
  return savePath;
}

function calcDataDate(dayOffset) {
  const d = new Date();
  d.setDate(d.getDate() - 1 - dayOffset);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${mo}/${day}`;
}

/**
 * 对外入口：
 *  - 导航到视频明细页
 *  - 循环导出多天数据：dayOffset=0..daysToExport-1
 *    每天依次：选择自然日(offset)→非投放 tab→下载明细→追加数据日期
 *
 * @param {import('playwright').Page} page
 * @param {{ tag: string, saveDir: string, shopName?: string, daysToExport?: number }} options
 */
async function downloadVideoSelfDetail(page, { tag, saveDir, shopName, daysToExport = 1 }) {
  const startedAll = Date.now();
  const allFailures = [];
  logStep(tag, `视频下载开始，目标店铺: ${shopName || "(未指定)"}，循环天数: ${daysToExport}`);

  await gotoVideoSelf(page, tag);

  const results = [];

  for (let offset = 0; offset < daysToExport; offset++) {
    logStep(tag, `--- 第 ${offset + 1}/${daysToExport} 轮（offset=${offset}）---`);

    const { dataDate, failures: dateFailures } = await selectDateRangeYesterday(page, tag, offset);
    if (dateFailures && dateFailures.length) {
      allFailures.push(...dateFailures);
    }

    const expectedDate = calcDataDate(offset);
    const dateMatch = dataDate && dataDate === expectedDate;
    if (dataDate && !dateMatch) {
      console.warn(`[${tag}] ⚠ 日历选中日期 ${dataDate} ≠ 预期 ${expectedDate} (offset=${offset})`);
    }
    if (dataDate && dateMatch) {
      // Only log but still track that we had no match
    }

    const nonAdResult = await selectNonAdTab(page, tag);
    if (nonAdResult.failures && nonAdResult.failures.length) {
      allFailures.push(...nonAdResult.failures);
    }

    await page.waitForTimeout(1200);

    const targetDir = shopName
      ? path.join(saveDir, safeShopDirName(shopName), "视频明细")
      : saveDir;
    const savePath = await clickDownloadAndSave(page, tag, targetDir, {
      exportLabel: "视频明细"
    });

    const dateToWrite = expectedDate;
    try {
      appendDataDateColumn(savePath, dateToWrite);
      logStep(tag, `数据日期写入: ${dateToWrite}`);
    } catch (e) {
      logWarn(tag, `写入「数据日期」列失败: ${e.message || e}`);
    }

    results.push({ savePath, dataDate: dateToWrite, dateMatch });

    if (offset < daysToExport - 1) {
      await page.waitForTimeout(800);
    }
  }

  logStep(tag, `视频下载流程完成，共 ${results.length} 天`, startedAll);
  return results.length > 0
    ? { savePath: results[0].savePath, dataDate: results[0].dataDate, allResults: results, failures: allFailures }
    : { savePath: null, dataDate: null, allResults: [], failures: allFailures };
}

module.exports = {
  VIDEO_SELF_URL,
  gotoVideoSelf,
  waitForVideoSelfReady,
  ensureVideoDetailTab,
  selectNonAdTab,
  selectDateRangeYesterday,
  clickDownloadAndSave,
  downloadVideoSelfDetail,
  safeShopDirName,
  calcDataDate
};
