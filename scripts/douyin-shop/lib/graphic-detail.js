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

const GRAPHIC_URL =
  process.env.SHOP_GRAPHIC_URL ||
  "https://compass.jinritemai.com/shop/graphic/graphic-analysis";
const GRAPHIC_READY_TIMEOUT_MS = Number(process.env.SHOP_GRAPHIC_READY_TIMEOUT_MS || 60000);

const { logInfo, logWarn: logWarnLine, buildShopStepMeta } = require("./shop-log");

function logStep() {}

function logWarn(tag, msg) {
  logWarnLine(`[${tag}] ${msg}`);
}

function logSaved(tag, savePath) {
  logInfo(`[${tag}] 已保存 ${path.basename(savePath)}`);
}

/**
 * 图文分析页：在已展开的自然日面板中点击日历「最新可选日 - dayOffset」。
 */
async function pickTargetInGraphicCalendar(page, tag, targetDate) {
  const started = Date.now();
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
    logStep(tag, `图文页已选择自然日 ${targetDate}`, started);
    if (dataDate) {
      logStep(tag, `解析到的数据日期: ${dataDate}`, started);
    }
  } else if (pickResult.reason === "disabled") {
    logWarn(tag, `目标日期 ${targetDate} 在日历中不可选（数据可能未产出）`);
  } else {
    logWarn(tag, `图文页日历中未能选中目标日期 ${targetDate}`);
  }

  await page.waitForTimeout(400);
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.move(10, 10).catch(() => {});
  await page.waitForTimeout(300);
  return { ok: clicked, dataDate, reason: pickResult.reason || null };
}

/**
 * 图文分析页：直接点顶部「自然日」触发器，弹层内确认「自然日」后，
 * 在日历中选第 (dayOffset+1) 个可选日期。
 */
async function selectGraphicNaturalDayYesterday(page, tag, targetDate) {
  const started = Date.now();
  const nat = page
    .locator(
      'label.ecom-radio-button-wrapper.ecom-dropdown-trigger:has-text("自然日"), label.ecom-radio-button-wrapper:has-text("自然日")'
    )
    .first();

  const vis = await nat
    .waitFor({ state: "visible", timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  if (!vis) {
    logWarn(tag, '图文页未找到「自然日」日期触发器，跳过改日期');
    return { ok: false, dataDate: null };
  }

  await nat.hover({ timeout: 1000 }).catch(() => {});
  await nat.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(400);

  const dropdown = page
    .locator(".ecom-dorami-date-picker-quick-picker-dropdown")
    .first();
  const ddOk = await dropdown
    .isVisible({ timeout: 3000 })
    .catch(() => false);

  if (ddOk) {
    let naturalItem = dropdown
      .locator('li.ecom-menu-item:has-text("自然日")')
      .first();
    if (!(await naturalItem.isVisible({ timeout: 400 }).catch(() => false))) {
      naturalItem = dropdown
        .locator('span.ecom-menu-title-content:has-text("自然日")')
        .first();
    }
    if (await naturalItem.isVisible({ timeout: 1500 }).catch(() => false)) {
      await naturalItem.hover({ timeout: 800 }).catch(() => {});
      await naturalItem.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
      logStep(tag, '图文日期弹层内已选「自然日」', started);
    }
  }

  const picked = await pickTargetInGraphicCalendar(page, tag, targetDate);
  logStep(tag, `selectGraphicNaturalDayYesterday(${targetDate}) ${picked.ok ? "完成" : "可能未点到"}`, started);
  return picked;
}

async function waitForGraphicPageReady(page, tag, timeoutMs = 25000) {
  const started = Date.now();
  const detail = page.locator("#graphicDetail").first();
  const ok = await detail
    .waitFor({ state: "visible", timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    logWarn(tag, `#graphicDetail ${timeoutMs}ms 内未出现`);
    return false;
  }
  await page
    .locator("#graphicDetail button:has-text(\"下载明细\")")
    .first()
    .waitFor({ state: "visible", timeout: 12000 })
    .catch(() => {});
  logStep(tag, "图文分析页主体已就绪", started);
  return true;
}

async function gotoGraphic(page, tag) {
  const started = Date.now();
  const url = (page.url() || "").replace(/\/$/, "");
  const base = GRAPHIC_URL.replace(/\/$/, "");
  if (!url.startsWith(base)) {
    logStep(tag, `跳转图文分析页: ${GRAPHIC_URL}`);
    await retryableGoto(page, GRAPHIC_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
      maxRetries: 2,
      baseBackoff: 2500,
      expectedUrlRe: /compass\.jinritemai\.com\/shop\/graphic\/graphic-analysis/
    });
  } else {
    logStep(tag, "当前已在图文分析页路径");
  }
  let ready = await waitForGraphicPageReady(page, tag, GRAPHIC_READY_TIMEOUT_MS);
  if (!ready) {
    logWarn(tag, "图文分析页主体未就绪，重试一次导航");
    await retryableGoto(page, GRAPHIC_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
      maxRetries: 1,
      baseBackoff: 2500,
      expectedUrlRe: /compass\.jinritemai\.com\/shop\/graphic\/graphic-analysis/
    });
    ready = await waitForGraphicPageReady(page, tag, GRAPHIC_READY_TIMEOUT_MS);
  }
  if (!ready) {
    throw new Error(`图文分析页主体未就绪（${GRAPHIC_READY_TIMEOUT_MS}ms）`);
  }
  logStep(tag, "gotoGraphic 完成", started);
}

function safeShopDirName(name) {
  return String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ");
}

async function clickGraphicDownloadAndSave(page, tag, saveDir, options = {}) {
  const exportBatchId = options.exportBatchId ? String(options.exportBatchId) : null;
  const started = Date.now();
  await fse.ensureDir(saveDir);

  const btn = page.locator("#graphicDetail button:has-text(\"下载明细\")").first();
  await btn.waitFor({ state: "visible", timeout: 12000 });

  logStep(tag, "点击图文「下载明细」");
  const download = await retryableDownload(
    page,
    () => btn.click({ timeout: 3000 }),
    {
      timeout: 60000,
      maxRetries: 2,
      retryDelay: 3000
    }
  );

  const rawName =
    download.suggestedFilename() || `graphic-detail-${Date.now()}.csv`;
  const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_");
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const batchPrefix = exportBatchId ? `${exportBatchId}-` : "";
  const savePath = path.join(saveDir, `${batchPrefix}${ts}-图文明细-${safeName}`);

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
 * 罗盘「图文分析」导出：自然日 + 日历循环多天 + 下载明细。
 * 文件落在 saveDir/<店铺名>/图文明细/ 下。
 *
 * @param {import('playwright').Page} page
 * @param {{ tag: string, saveDir: string, shopName?: string, daysToExport?: number }} options
 */
async function downloadGraphicDetail(page, {
  tag,
  saveDir,
  shopName,
  daysToExport = 1,
  exportBatchId = null,
  accountEmail = "",
  targetDates = null,
  targetKinds = null,
  stepRunner = null,
  stepIndexBase = 200,
  shopIndex = null,
  shopTotal = null
}) {
  const startedAll = Date.now();
  logStep(tag, `图文明细下载开始，店铺: ${shopName || "(未指定)"}，循环天数: ${daysToExport}`);

  const dateSet = buildTargetDateSet(targetDates);
  const kindSet = Array.isArray(targetKinds) && targetKinds.length > 0 ? new Set(targetKinds) : null;
  const runStep = stepRunner?.runStep;
  const stepMeta = (fields = {}) =>
    buildShopStepMeta({
      shopName,
      kind: "graphic",
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

  if (kindSet && !kindSet.has("graphic")) {
    logStep(tag, "补跑目标不包含图文，跳过图文明细下载");
    await withStep(
      stepIndexBase,
      "跳过图文明细下载",
      "graphic-skipped-by-target-kind",
      null,
      {
        skipped: true,
        skipReason: "补跑目标不包含 graphic",
        meta: stepMeta()
      }
    );
    return { savePath: null, dataDate: null, allResults: [], failures: [], targetCount: 0 };
  }

  await withStep(
    stepIndexBase,
    "进入图文分析页",
    "graphic-open-page",
    async () => {
      await gotoGraphic(page, tag);
    },
    {
      verify: async () => {
        const ok = await waitForGraphicPageReady(page, tag, 10000);
        if (!ok) throw new Error("图文分析页主体未就绪");
      },
      meta: stepMeta()
    }
  );

  const results = [];
  let targetCount = 0;

  for (let offset = 0; offset < daysToExport; offset++) {
    logStep(tag, `--- 图文明细第 ${offset + 1}/${daysToExport} 轮（offset=${offset}）---`);

    const expectedDate = calcDataDate(offset);
    if (dateSet && !dateSet.has(expectedDate)) {
      logStep(tag, `跳过非补跑目标日期: ${expectedDate}`);
      await withStep(
        stepIndexBase + 1 + offset * 3,
        "跳过图文非目标日期",
        `graphic-skip-date-${offset + 1}`,
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
      stepIndexBase + 1 + offset * 3,
      "选择图文自然日",
      `graphic-select-date-${offset + 1}`,
      async () => {
        const selected = await selectGraphicNaturalDayYesterday(page, tag, expectedDate);
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
        kind: "graphic",
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
      kind: "graphic",
      dataDate: expectedDate,
      expectedDate
    };
    await markRunning(item);
    const dateMatch = true;

    await page.waitForTimeout(1200);

    const targetDir = shopName
      ? path.join(saveDir, safeShopDirName(shopName), "图文明细")
      : saveDir;
    let savePath;
    try {
      await withStep(
        stepIndexBase + 2 + offset * 3,
        "下载图文明细文件",
        `graphic-download-file-${offset + 1}`,
        async () => {
          savePath = await clickGraphicDownloadAndSave(page, tag, targetDir, {
            exportBatchId
          });
        },
        {
          verify: async () => {
            if (!savePath) throw new Error("图文明细未返回保存路径");
            const stat = await fse.stat(savePath).catch(() => null);
            if (!stat || stat.size <= 0) {
              throw new Error(`图文明细文件不存在或为空: ${savePath}`);
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
      stepIndexBase + 3 + offset * 3,
      "写入图文数据日期",
      `graphic-write-data-date-${offset + 1}`,
      async () => {
        appendDataDateColumn(savePath, dateToWrite);
        logStep(tag, `图文数据日期写入: ${dateToWrite}`);
        await markSuccess(item, savePath);
      },
      {
        verify: async () => {
          const stat = await fse.stat(savePath).catch(() => null);
          if (!stat || stat.size <= 0) {
            throw new Error(`图文明细文件写入后不可用: ${savePath}`);
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

    if (offset < daysToExport - 1) {
      await page.waitForTimeout(800);
    }
  }

  logStep(tag, `图文明细下载完成，成功 ${results.filter((r) => r.savePath && r.dateMatch !== false).length}/${targetCount || daysToExport} 天`, startedAll);
  const failures = results
    .filter((r) => r.dateMatch === false || !r.savePath)
    .map((r) => ({
      step: "图文日期选择/下载",
      dataDate: r.dataDate || r.expectedDate || null,
      error: r.error || "图文明细未成功下载"
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
  GRAPHIC_URL,
  gotoGraphic,
  downloadGraphicDetail,
  safeShopDirName
};
