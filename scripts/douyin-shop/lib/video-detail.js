const path = require("path");
const fse = require("fs-extra");

const {
  pickCalendarDayByTargetDate,
  retryableDownload,
  retryableGoto
} = require("./page-utils");
const { appendDataDateColumn } = require("./merge-shop-exports");
const {
  markFailed,
  markRunning,
  markSuccess
} = require("./export-item-store");

const VIDEO_SELF_URL =
  process.env.SHOP_VIDEO_SELF_URL ||
  "https://compass.jinritemai.com/shop/video/self";
const VIDEO_READY_TIMEOUT_MS = Number(process.env.SHOP_VIDEO_READY_TIMEOUT_MS || 60000);

const { logInfo, logWarn: logWarnLine, buildShopStepMeta } = require("./shop-log");

function logStep() {}

function logWarn(tag, msg) {
  logWarnLine(`[${tag}] ${msg}`);
}

function logSaved(tag, savePath) {
  logInfo(`[${tag}] 已保存 ${path.basename(savePath)}`);
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
      return true;
    }
    await page.waitForTimeout(300);
  }
  logWarn(tag, `视频明细页筛选区 ${timeoutMs}ms 内未全部就绪`);
  return false;
}

async function gotoVideoSelf(page, tag) {
  const started = Date.now();
  const url = page.url() || "";
  if (!url.startsWith(VIDEO_SELF_URL)) {
    logStep(tag, `跳转至短视频明细页: ${VIDEO_SELF_URL}`);
    try {
      await retryableGoto(page, VIDEO_SELF_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
        maxRetries: 2,
        baseBackoff: 2500,
        expectedUrlRe: /compass\.jinritemai\.com\/shop\/video\/self/
      });
    } catch (error) {
      logWarn(tag, `跳转短视频明细页失败: ${error.message || error}`);
      throw error;
    }
  } else {
    logStep(tag, `当前已在短视频明细页`);
  }

  let ready = await waitForVideoSelfReady(page, tag, VIDEO_READY_TIMEOUT_MS);
  if (!ready) {
    logWarn(tag, "短视频明细页未就绪，重试一次导航");
    await retryableGoto(page, VIDEO_SELF_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
      maxRetries: 1,
      baseBackoff: 2500,
      expectedUrlRe: /compass\.jinritemai\.com\/shop\/video\/self/
    });
    ready = await waitForVideoSelfReady(page, tag, VIDEO_READY_TIMEOUT_MS);
  }
  if (!ready) {
    throw new Error(`短视频明细页筛选区未就绪（${VIDEO_READY_TIMEOUT_MS}ms）`);
  }
  logStep(tag, `gotoVideoSelf 完成`, started);
}

/**
 * 视频明细：悬浮「更多」→ 左侧选「自然日」→ 日历里按 targetDate (YYYY/MM/DD) 精准选日。
 */
async function selectDateRangeYesterday(page, tag, targetDate) {
  const started = Date.now();

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
    logWarn(tag, '未找到"更多"按钮，跳过日期选择');
    return { ok: false, dataDate: null };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await moreTrigger.hover({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(350);
    const dropdownVisible = await page
      .locator(".ecom-dorami-date-picker-quick-picker-dropdown")
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (dropdownVisible) break;
    if (attempt === 2) {
      logWarn(tag, `hover "更多" 3 次后弹层仍未出现`);
    }
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
  if (await naturalDay.isVisible({ timeout: 1500 }).catch(() => false)) {
    await naturalDay.hover({ timeout: 1000 }).catch(() => {});
    await naturalDay.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
    logStep(tag, '已点击"自然日"分类');
  } else {
    logWarn(tag, '悬浮"更多"后仍未找到"自然日"选项');
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

  const pickResult = await pickCalendarDayByTargetDate(page, scope, targetDate);
  const clicked = Boolean(pickResult.ok);
  const dataDate = pickResult.dataDate || null;
  if (clicked) {
    logStep(tag, `已选择自然日 ${targetDate}`);
    if (dataDate) {
      logStep(tag, `解析到的数据日期: ${dataDate}`);
    }
  } else if (pickResult.reason === "disabled") {
    logWarn(tag, `目标日期 ${targetDate} 在日历中不可选（数据可能未产出）`);
  } else {
    logWarn(tag, `日历中未能选中目标日期 ${targetDate}`);
  }

  await page.waitForTimeout(400);
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.move(10, 10).catch(() => {});
  await page.waitForTimeout(300);

  logStep(tag, `selectDateRangeYesterday(${targetDate}) ${clicked ? "成功" : "失败"}`, started);
  return { ok: clicked, dataDate, reason: pickResult.reason || null };
}

async function ensureVideoDetailTab(page, tag) {
  const started = Date.now();
  const tabSel = 'div[role="tab"]:has-text("视频明细"), :text-is("视频明细")';
  let tab = page.locator(tabSel).first();
  const visible1 = await tab.isVisible({ timeout: 2000 }).catch(() => false);
  if (!visible1) {
    await page.mouse.wheel(0, 900).catch(() => {});
    await page.waitForTimeout(300);
    tab = page.locator(tabSel).first();
    const visible2 = await tab.isVisible({ timeout: 1500 }).catch(() => false);
    if (!visible2) {
      logWarn(tag, '未找到"视频明细" Tab，按当前 tab 继续');
      return false;
    }
  }
  const selected = await tab.getAttribute("aria-selected").catch(() => null);
  if (selected === "true") {
    logStep(tag, '"视频明细" Tab 已选中', started);
    return true;
  }
  await tab.scrollIntoViewIfNeeded().catch(() => {});
  await tab.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(600);
  logStep(tag, '已切换到"视频明细" Tab', started);
  return true;
}

async function selectNonAdTab(page, tag) {
  const started = Date.now();
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
      logWarn(tag, '未找到"非投放" Tab，跳过切换');
      return false;
    }
  }

  const selected = await targetTab.getAttribute("aria-selected").catch(() => null);
  if (selected === "true") {
    logStep(tag, '投放属性已为"非投放"，跳过切换', started);
    return true;
  }

  await targetTab.click({ timeout: 3000 }).catch(() => {});
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
    logWarn(tag, '点击"非投放"后未观察到 aria-selected=true 切换');
  }
  return ok;
}

function safeShopDirName(name) {
  return String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ");
}

async function clickDownloadAndSave(page, tag, saveDir, options = {}) {
  const exportLabel = options.exportLabel || "视频明细";
  const exportBatchId = options.exportBatchId ? String(options.exportBatchId) : null;
  const started = Date.now();
  await fse.ensureDir(saveDir);

  const allButtons = page.locator('button:has-text("下载明细")');
  const btnCount = await allButtons.count().catch(() => 0);
  if (btnCount === 0) {
    throw new Error('页面上未找到"下载明细"按钮');
  }
  const downloadBtn = allButtons.nth(btnCount - 1);
  await downloadBtn.waitFor({ state: "visible", timeout: 8000 });

  logStep(tag, `发现 ${btnCount} 个"下载明细"按钮，点击最后一个（${exportLabel}）`);
  const download = await retryableDownload(
    page,
    () => downloadBtn.click({ timeout: 3000 }),
    {
      timeout: 60000,
      maxRetries: 2,
      retryDelay: 3000
    }
  );

  const rawName =
    download.suggestedFilename() || `video-detail-${Date.now()}.csv`;
  const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_");
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const batchPrefix = exportBatchId ? `${exportBatchId}-` : "";
  const savePath = path.join(saveDir, `${batchPrefix}${ts}-${exportLabel}-${safeName}`);

  await download.saveAs(savePath);
  logSaved(tag, savePath);
  return savePath;
}

/** 根据 dayOffset 计算实际数据日期（昨天 - offset），格式 YYYY/MM/DD */
function calcDataDate(dayOffset) {
  const d = new Date();
  d.setDate(d.getDate() - 1 - dayOffset);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${mo}/${day}`;
}

function buildTargetDateSet(targetDates) {
  if (!Array.isArray(targetDates) || targetDates.length === 0) return null;
  const values = new Set();
  for (const item of targetDates) {
    const raw = String(item || "").trim();
    if (!raw) continue;
    values.add(raw);
    values.add(raw.replace(/-/g, "/"));
  }
  return values.size > 0 ? values : null;
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
async function downloadVideoSelfDetail(page, {
  tag,
  saveDir,
  shopName,
  daysToExport = 1,
  exportBatchId = null,
  accountEmail = "",
  targetDates = null,
  targetKinds = null,
  stepRunner = null,
  stepIndexBase = 100,
  shopIndex = null,
  shopTotal = null
}) {
  const startedAll = Date.now();
  logStep(tag, `视频下载开始，目标店铺: ${shopName || "(未指定)"}，循环天数: ${daysToExport}`);

  const dateSet = buildTargetDateSet(targetDates);
  const kindSet = Array.isArray(targetKinds) && targetKinds.length > 0 ? new Set(targetKinds) : null;
  const runStep = stepRunner?.runStep;
  const stepMeta = (fields = {}) =>
    buildShopStepMeta({
      shopName,
      kind: "video",
      shopIndex,
      shopTotal,
      daysToExport,
      ...fields
    });
  const withStep = async (index, title, stepTag, action, verifyOrOptions, maybeOptions) => {
    if (typeof runStep === "function") {
      return await runStep(index, title, stepTag, action, verifyOrOptions, maybeOptions);
    }
    if (typeof action === "function") await action();
    const verify = verifyOrOptions && typeof verifyOrOptions === "object"
      ? verifyOrOptions.verify
      : verifyOrOptions;
    if (typeof verify === "function") await verify();
  };

  if (kindSet && !kindSet.has("video")) {
    logStep(tag, "补跑目标不包含视频，跳过视频下载");
    await withStep(
      stepIndexBase,
      "跳过短视频明细下载",
      "video-skipped-by-target-kind",
      null,
      {
        skipped: true,
        skipReason: "补跑目标不包含 video",
        meta: stepMeta()
      }
    );
    return { savePath: null, dataDate: null, allResults: [], failures: [], targetCount: 0 };
  }

  await withStep(
    stepIndexBase,
    "进入短视频明细页",
    "video-open-page",
    async () => {
      await gotoVideoSelf(page, tag);
    },
    {
      verify: async () => {
        const ok = await waitForVideoSelfReady(page, tag, 10000);
        if (!ok) throw new Error("短视频明细页筛选区未就绪");
      },
      meta: stepMeta()
    }
  );

  const results = [];
  let targetCount = 0;

  for (let offset = 0; offset < daysToExport; offset++) {
    logStep(tag, `--- 第 ${offset + 1}/${daysToExport} 轮（offset=${offset}）---`);

    const expectedDate = calcDataDate(offset);
    if (dateSet && !dateSet.has(expectedDate)) {
      logStep(tag, `跳过非补跑目标日期: ${expectedDate}`);
      await withStep(
        stepIndexBase + 1 + offset * 4,
        "跳过短视频非目标日期",
        `video-skip-date-${offset + 1}`,
        null,
        {
          skipped: true,
          skipReason: `非补跑目标日期: ${expectedDate}`,
          meta: stepMeta({ dataDate: expectedDate, offset })
        }
      );
      continue;
    }
    targetCount += 1;

    let datePicked = false;
    let dataDate = null;
    let pickReason = null;
    await withStep(
      stepIndexBase + 1 + offset * 4,
      "选择短视频自然日",
      `video-select-date-${offset + 1}`,
      async () => {
        const selected = await selectDateRangeYesterday(page, tag, expectedDate);
        datePicked = Boolean(selected.ok);
        dataDate = selected.dataDate || null;
        pickReason = selected.reason || null;
      },
      {
        verify: async () => {
          if (!datePicked || !dataDate) {
            if (pickReason === "disabled") {
              throw new Error(`目标日期 ${expectedDate} 在日历中不可选（数据可能未产出）`);
            }
            throw new Error(`未能选择或解析日期，预期 ${expectedDate}`);
          }
          if (dataDate !== expectedDate) {
            throw new Error(`日历选中 ${dataDate} ≠ 预期 ${expectedDate}`);
          }
        },
        meta: stepMeta({ dataDate: expectedDate, offset })
      }
    ).catch(async (error) => {
      const msg = error?.message || String(error);
      await markFailed({
        runId: exportBatchId,
        accountEmail,
        shopName: shopName || "unknown",
        kind: "video",
        dataDate: expectedDate,
        expectedDate
      }, msg);
      results.push({ savePath: null, dataDate: dataDate || null, expectedDate, dateMatch: false, error: msg });
    });
    if (results.some((r) => r.expectedDate === expectedDate && r.dateMatch === false && !r.savePath)) {
      continue;
    }
    const item = {
      runId: exportBatchId,
      accountEmail,
      shopName: shopName || "unknown",
      kind: "video",
      dataDate: expectedDate,
      expectedDate
    };
    await markRunning(item);
    const dateMatch = true;

    await withStep(
      stepIndexBase + 2 + offset * 4,
      "切换短视频非投放",
      `video-select-non-ad-${offset + 1}`,
      async () => {
        await selectNonAdTab(page, tag);
      },
      {
        meta: stepMeta({ dataDate: expectedDate, offset })
      }
    );

    await page.waitForTimeout(1200);

    const targetDir = shopName
      ? path.join(saveDir, safeShopDirName(shopName), "视频明细")
      : saveDir;
    let savePath;
    try {
      await withStep(
        stepIndexBase + 3 + offset * 4,
        "下载短视频明细文件",
        `video-download-file-${offset + 1}`,
        async () => {
          savePath = await clickDownloadAndSave(page, tag, targetDir, {
            exportLabel: "视频明细",
            exportBatchId
          });
        },
        {
          verify: async () => {
            if (!savePath) throw new Error("短视频明细未返回保存路径");
            const stat = await fse.stat(savePath).catch(() => null);
            if (!stat || stat.size <= 0) {
              throw new Error(`短视频明细文件不存在或为空: ${savePath}`);
            }
          },
          meta: stepMeta({ dataDate: expectedDate, offset })
        }
      );
    } catch (error) {
      const msg = error?.message || String(error);
      await markFailed(item, msg);
      results.push({ savePath: null, dataDate: expectedDate, expectedDate, dateMatch: false, error: msg });
      continue;
    }

    const dateToWrite = expectedDate;
    await withStep(
      stepIndexBase + 4 + offset * 4,
      "写入短视频数据日期",
      `video-write-data-date-${offset + 1}`,
      async () => {
        appendDataDateColumn(savePath, dateToWrite);
        logStep(tag, `数据日期写入: ${dateToWrite}`);
        await markSuccess(item, savePath);
      },
      {
        verify: async () => {
          const stat = await fse.stat(savePath).catch(() => null);
          if (!stat || stat.size <= 0) {
            throw new Error(`短视频明细文件写入后不可用: ${savePath}`);
          }
        },
        meta: stepMeta({ dataDate: expectedDate, offset })
      }
    ).catch(async (e) => {
      const msg = e?.message || String(e);
      await markFailed(item, msg);
      results.push({ savePath: null, dataDate: expectedDate, expectedDate, dateMatch: false, error: msg });
    });
    if (results.some((r) => r.expectedDate === expectedDate && r.dateMatch === false && !r.savePath)) {
      continue;
    }

    results.push({ savePath, dataDate: dateToWrite, dateMatch });

    // 非最后一轮，让页面稳定后再进入下一轮
    if (offset < daysToExport - 1) {
      await page.waitForTimeout(800);
    }
  }

  logStep(tag, `视频下载流程完成，成功 ${results.filter((r) => r.savePath && r.dateMatch !== false).length}/${targetCount || daysToExport} 天`, startedAll);
  const failures = results
    .filter((r) => r.dateMatch === false || !r.savePath)
    .map((r) => ({
      step: "视频日期选择/下载",
      dataDate: r.dataDate || r.expectedDate || null,
      error: r.error || "视频明细未成功下载"
    }));
  const firstSuccess = results.find((r) => r.savePath);
  return results.length > 0
    ? {
        savePath: firstSuccess?.savePath || null,
        dataDate: firstSuccess?.dataDate || null,
        allResults: results,
        failures,
        targetCount
      }
    : { savePath: null, dataDate: null, allResults: [], failures, targetCount };
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
