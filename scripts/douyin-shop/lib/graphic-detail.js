const path = require("path");
const fs = require("fs/promises");

const {
  pickLatestSelectableCalendarDay
} = require("./pick-latest-calendar-day");
const { appendDataDateColumn } = require("./append-data-date-column");

const GRAPHIC_URL =
  process.env.SHOP_GRAPHIC_URL ||
  "https://compass.jinritemai.com/shop/graphic/graphic-analysis";

function logStep(tag, msg, started) {
  const dur = started ? ` (+${Date.now() - started}ms)` : "";
  console.log(`[${tag}] ${msg}${dur}`);
}

function logWarn(tag, msg) {
  console.warn(`[${tag}] ${msg}`);
}

/**
 * 图文分析页：在已展开的自然日面板中点击日历「最新可选日 - dayOffset」。
 */
async function pickLatestInGraphicCalendar(page, tag, dayOffset = 0) {
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

  const pickResult = await pickLatestSelectableCalendarDay(page, scope, dayOffset);
  const clicked = Boolean(pickResult.ok);
  const dataDate = pickResult.dataDate || null;
  if (clicked) {
    logStep(tag, `图文页已选择日历第${dayOffset + 1}个可选自然日`, started);
    if (dataDate) {
      logStep(tag, `解析到的数据日期: ${dataDate}`, started);
    }
  } else {
    logWarn(tag, "图文页日历中未找到可点击的日期格");
  }

  await page.waitForTimeout(400);
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.move(10, 10).catch(() => {});
  await page.waitForTimeout(300);
  return { ok: clicked, dataDate };
}

/**
 * 图文分析页：直接点顶部「自然日」触发器，弹层内确认「自然日」后，
 * 在日历中选第 (dayOffset+1) 个可选日期。
 */
async function selectGraphicNaturalDayYesterday(page, tag, dayOffset = 0) {
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

  const picked = await pickLatestInGraphicCalendar(page, tag, dayOffset);
  logStep(tag, `selectGraphicNaturalDayYesterday(offset=${dayOffset}) ${picked.ok ? "完成" : "可能未点到"}`, started);
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
    await page.goto(GRAPHIC_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20000
    });
  } else {
    logStep(tag, "当前已在图文分析页路径");
  }
  await waitForGraphicPageReady(page, tag, 25000);
  logStep(tag, "gotoGraphic 完成", started);
}

function safeShopDirName(name) {
  return String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ");
}

async function clickGraphicDownloadAndSave(page, tag, saveDir) {
  const started = Date.now();
  await fs.mkdir(saveDir, { recursive: true });

  const btn = page.locator("#graphicDetail button:has-text(\"下载明细\")").first();
  await btn.waitFor({ state: "visible", timeout: 12000 });

  logStep(tag, "点击图文「下载明细」");
  const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
  await btn.click({ timeout: 3000 });

  let download;
  try {
    download = await downloadPromise;
  } catch (error) {
    throw new Error(
      `图文点击「下载明细」后 60s 内未触发下载：${error.message || error}`
    );
  }

  const rawName =
    download.suggestedFilename() || `graphic-detail-${Date.now()}.csv`;
  const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_");
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const savePath = path.join(saveDir, `${ts}-图文明细-${safeName}`);

  await download.saveAs(savePath);
  logStep(tag, `图文明细已保存: ${savePath}`, started);
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

/**
 * 罗盘「图文分析」导出：自然日 + 日历循环多天 + 下载明细。
 * 文件落在 saveDir/<店铺名>/图文明细/ 下。
 *
 * @param {import('playwright').Page} page
 * @param {{ tag: string, saveDir: string, shopName?: string, daysToExport?: number }} options
 */
async function downloadGraphicDetail(page, { tag, saveDir, shopName, daysToExport = 1 }) {
  const startedAll = Date.now();
  logStep(tag, `图文明细下载开始，店铺: ${shopName || "(未指定)"}，循环天数: ${daysToExport}`);

  await gotoGraphic(page, tag);

  const results = [];

  for (let offset = 0; offset < daysToExport; offset++) {
    logStep(tag, `--- 图文明细第 ${offset + 1}/${daysToExport} 轮（offset=${offset}）---`);

    const { dataDate } = await selectGraphicNaturalDayYesterday(page, tag, offset);

    await page.waitForTimeout(1200);

    const targetDir = shopName
      ? path.join(saveDir, safeShopDirName(shopName), "图文明细")
      : saveDir;
    const savePath = await clickGraphicDownloadAndSave(page, tag, targetDir);

    const actualDate = calcDataDate(offset);
    const dateToWrite = dataDate || actualDate;
    try {
      appendDataDateColumn(savePath, dateToWrite);
      logStep(tag, `图文数据日期写入: ${dateToWrite}`);
    } catch (e) {
      logWarn(tag, `写入「数据日期」列失败: ${e.message || e}`);
    }

    results.push({ savePath, dataDate: dateToWrite });

    if (offset < daysToExport - 1) {
      await page.waitForTimeout(800);
    }
  }

  logStep(tag, `图文明细下载完成，共 ${results.length} 天`, startedAll);
  return results.length > 0
    ? { savePath: results[0].savePath, dataDate: results[0].dataDate, allResults: results }
    : { savePath: null, dataDate: null, allResults: [] };
}

module.exports = {
  GRAPHIC_URL,
  gotoGraphic,
  downloadGraphicDetail,
  safeShopDirName
};
