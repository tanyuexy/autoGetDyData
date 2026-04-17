const path = require("path");
const fs = require("fs/promises");

const GRAPHIC_URL =
  process.env.SHOP_GRAPHIC_URL ||
  "https://compass.jinritemai.com/shop/graphic/";

function logStep(tag, msg, started) {
  const dur = started ? ` (+${Date.now() - started}ms)` : "";
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${msg}${dur}`);
}

function logWarn(tag, msg) {
  // eslint-disable-next-line no-console
  console.warn(`[${tag}] ${msg}`);
}

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

function getYesterday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
}

/**
 * 与 video-detail 共用的日历点选逻辑：在已展开的 ecom-picker 中点击「昨天」。
 */
async function pickYesterdayInCalendar(page, tag) {
  const started = Date.now();
  const yesterday = getYesterday();
  const ymdSlash = formatYmd(yesterday);
  const dayNum = String(yesterday.getDate());

  await page
    .locator(".ecom-picker-body")
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {});

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

  const yesterdayCell = scope
    .locator(
      `td.ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) >> .ecom-picker-cell-inner:text-is("${dayNum}")`
    )
    .first();

  let clicked = false;
  if (await yesterdayCell.isVisible({ timeout: 2000 }).catch(() => false)) {
    await yesterdayCell.click({ timeout: 2000 }).catch(() => {});
    clicked = true;
    logStep(tag, `图文页已选择日期: ${ymdSlash}`, started);
  }

  if (!clicked) {
    const fallback = scope
      .locator(
        `.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner:text-is("${dayNum}")`
      )
      .first();
    if (await fallback.isVisible({ timeout: 800 }).catch(() => false)) {
      await fallback.click({ timeout: 2000 }).catch(() => {});
      clicked = true;
      logStep(tag, `图文页已选择日期（兜底）: ${ymdSlash}`, started);
    }
  }

  if (!clicked) {
    logWarn(tag, `图文页未能点中昨天 ${ymdSlash}`);
  }

  await page.waitForTimeout(400);
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.move(10, 10).catch(() => {});
  await page.waitForTimeout(300);
  return clicked;
}

/**
 * 图文分析页：顶部日期区为「自然日」radio + dropdown，点击后选自然日 + 日历中的昨天。
 * 与自营视频明细「更多 → 自然日」不同，这里直接点「自然日」触发器。
 */
async function selectGraphicNaturalDayYesterday(page, tag) {
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
    return false;
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

  const picked = await pickYesterdayInCalendar(page, tag);
  logStep(
    tag,
    `selectGraphicNaturalDayYesterday ${picked ? "完成" : "可能未点到昨天"}`,
    started
  );
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

/**
 *罗盘「图文分析」导出：自然日 + 昨天 + 下载明细。
 * 文件落在 saveDir/<店铺名>/图文明细/ 下，文件名含「图文明细」前缀。
 *
 * @param {import('playwright').Page} page
 * @param {{ tag: string, saveDir: string, shopName?: string }} options
 */
async function downloadGraphicDetail(page, { tag, saveDir, shopName }) {
  const startedAll = Date.now();
  logStep(tag, `图文明细下载开始，店铺: ${shopName || "(未指定)"}`);

  await gotoGraphic(page, tag);
  await selectGraphicNaturalDayYesterday(page, tag);

  await page.waitForTimeout(1200);

  const targetDir = shopName
    ? path.join(saveDir, safeShopDirName(shopName), "图文明细")
    : saveDir;
  const savePath = await clickGraphicDownloadAndSave(page, tag, targetDir);

  logStep(tag, "图文明细下载流程完成", startedAll);
  return { savePath };
}

module.exports = {
  GRAPHIC_URL,
  gotoGraphic,
  downloadGraphicDetail,
  safeShopDirName
};
