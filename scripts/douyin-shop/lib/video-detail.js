const path = require("path");
const fs = require("fs/promises");

const VIDEO_SELF_URL =
  process.env.SHOP_VIDEO_SELF_URL ||
  "https://compass.jinritemai.com/shop/video/self";

function logStep(tag, msg, started) {
  const dur = started ? ` (+${Date.now() - started}ms)` : "";
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${msg}${dur}`);
}

function logWarn(tag, msg) {
  // eslint-disable-next-line no-console
  console.warn(`[${tag}] ${msg}`);
}

/**
 * 等待自营视频明细页的"结构信号"就绪。
 * 实测：页面加载时即便 `text=短视频明细` 已出现，右侧筛选区 tabs 也可能还在 mount。
 * 真正能用的就绪信号是：顶部 "更多" 日期按钮 + "投放属性" 筛选 tab 同时可见。
 */
async function waitForVideoSelfReady(page, tag, timeoutMs = 20000) {
  const started = Date.now();
  // 先用常规页面指示器等一波（SPA 首次渲染）
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

  // 等日期筛选器（"更多" 按钮）或"投放属性" tab 任一出现，再多等一点让另一个也到位
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
  logWarn(
    tag,
    `视频明细页筛选区 ${timeoutMs}ms 内未全部就绪（"更多"或"非投放"缺失）`
  );
  return false;
}

/**
 * 导航到"短视频 > 自营视频 > 视频明细"页面。
 * 如果当前 URL 已经是目标页，直接等待页面就绪即可。
 */
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
 * 选择日期为"自然日 - 昨天"。
 *
 * 页面结构（罗盘 ecom-dorami-date-picker + ecom-picker 日历）：
 *  - 顶部 radio 组：实时/近1天/近7天/近30天/自然月/大促/更多
 *    "更多"按钮：label.ecom-radio-button-wrapper.ecom-dropdown-trigger（:has-text("更多")）
 *  - hover "更多"后出现弹层（挂在 body 下的 portal）：
 *      .ecom-dorami-date-picker-quick-picker-dropdown
 *        ├─ .ecom-dorami-date-picker-left-container  左侧菜单 ul.ecom-menu
 *        │    └─ li.ecom-menu-item > span.ecom-menu-title-content > div "自然日"/"自然周"/...
 *        └─ .ecom-dorami-date-picker-right-container 右侧日期面板
 *             └─ .ecom-picker-body 日历，每格是 td.ecom-picker-cell，
 *                可点击的包了 .ecom-picker-cell-in-view，不可点击是 .ecom-picker-cell-disabled，
 *                cell 内的点击热区是 .ecom-picker-cell-inner（其 innerText 为日期数字）
 */
async function selectDateRangeYesterday(page, tag) {
  const started = Date.now();
  const yesterday = getYesterday();
  const ymdSlash = formatYmd(yesterday);
  const dayNum = String(yesterday.getDate());

  // 1) 找"更多"按钮；有时页面刚加载完 DOM 还没挂上，这里额外 poll 一段时间
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
    logWarn(tag, '未找到"更多"按钮，跳过日期选择（默认保留近7天）');
    return false;
  }

  // 2) hover 展开弹层；抖音罗盘的 ecom-dropdown 是 hover 触发，停留时间要够
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
      logWarn(tag, `hover "更多" 3 次后弹层仍未出现，尝试在日历中直接选择昨天`);
    }
  }

  const dropdown = page
    .locator(".ecom-dorami-date-picker-quick-picker-dropdown")
    .first();

  // 3) 点击"自然日"
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
    logWarn(
      tag,
      '悬浮"更多"后仍未找到"自然日"选项，将直接在日历中兜底选昨天'
    );
  }

  // 4) 在右侧日历点击"昨天"
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
  if (await yesterdayCell.isVisible({ timeout: 1500 }).catch(() => false)) {
    await yesterdayCell.click({ timeout: 2000 }).catch(() => {});
    clicked = true;
    logStep(tag, `已选择日期: ${ymdSlash}`);
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
      logStep(tag, `已选择日期（兜底1）: ${ymdSlash}`);
    }
  }

  if (!clicked) {
    logWarn(
      tag,
      `未能精确点中昨天 ${ymdSlash}，尝试兜底点击日历中可点的最后一个可选日`
    );
    const enabledCells = scope.locator(
      ".ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
    );
    const count = await enabledCells.count().catch(() => 0);
    if (count > 0) {
      await enabledCells
        .nth(count - 1)
        .click({ timeout: 2000 })
        .catch(() => {});
      clicked = true;
    }
  }

  // 5) 收面板，把鼠标移开
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.move(10, 10).catch(() => {});
  await page.waitForTimeout(300);

  logStep(
    tag,
    `selectDateRangeYesterday ${clicked ? "成功" : "未能点中日期"}`,
    started
  );
  return clicked;
}

/**
 * 确保进入"视频明细"二级 Tab（页面顶部 tab：数据/经营建议/流量来源/带货商品/看后搜/视频明细）。
 * 若已选中则跳过。
 *
 * 注意：页面顶部"数据"tab 默认也有"下载明细"按钮和"投放属性"筛选，
 * 所以即使这一步失败也不会阻塞后续下载；这里成失败都只打日志。
 */
async function ensureVideoDetailTab(page, tag) {
  const started = Date.now();
  const tab = page
    .locator('div[role="tab"]:has-text("视频明细"), :text-is("视频明细")')
    .first();
  if (!(await tab.isVisible({ timeout: 2000 }).catch(() => false))) {
    logWarn(tag, '未找到"视频明细" Tab，按当前 tab 继续');
    return false;
  }
  const selected = await tab.getAttribute("aria-selected").catch(() => null);
  if (selected === "true") {
    logStep(tag, '"视频明细" Tab 已选中', started);
    return true;
  }
  await tab.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(600);
  logStep(tag, '已切换到"视频明细" Tab', started);
  return true;
}

/**
 * 将"投放属性"切换为"非投放"。
 * 页面结构：label "投放属性" 同级是一个 ecom-tabs 容器，内含 全部/投放/非投放。
 * 容器 id=_auto__ad_type；页面刷新后这个容器需要等一下才挂载。
 */
async function selectNonAdTab(page, tag) {
  const started = Date.now();
  // 先等容器或"非投放"任一出现（哪个先就用哪个）
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
      logWarn(
        tag,
        '未找到"非投放" Tab（容器 #_auto__ad_type 与文本匹配都超时），跳过切换'
      );
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
  // 等待"非投放"真正进入 selected 状态
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

/**
 * 把任意店铺名规整为可作为目录的字符串。
 * Windows/macOS 禁用字符统一替换为 _，避免 fs.mkdir 失败。
 */
function safeShopDirName(name) {
  return String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ");
}

/**
 * 点击"下载明细"按钮并保存文件。
 * 罗盘的下载可能是：
 * 1) 直接触发 download 事件（a[download] 或 Blob）
 * 2) 走异步导出中心（暂不处理）
 *
 * 页面可能同时存在多个"下载明细"按钮（数据 tab 与 视频明细 tab 各一个），
 * 这里优先用 nth-last（离视频明细区最近的那个，按 DOM 顺序通常排在后面）。
 */
async function clickDownloadAndSave(page, tag, saveDir) {
  const started = Date.now();
  await fs.mkdir(saveDir, { recursive: true });

  const allButtons = page.locator('button:has-text("下载明细")');
  const btnCount = await allButtons.count().catch(() => 0);
  if (btnCount === 0) {
    throw new Error('页面上未找到"下载明细"按钮');
  }
  // 优先选最后一个（自营视频/明细 tab 对应的下载按钮）
  const downloadBtn = allButtons.nth(btnCount - 1);
  await downloadBtn.waitFor({ state: "visible", timeout: 8000 });

  logStep(tag, `发现 ${btnCount} 个"下载明细"按钮，点击最后一个`);
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
  const savePath = path.join(saveDir, `${ts}-${safeName}`);

  await download.saveAs(savePath);
  logStep(tag, `明细文件已保存: ${savePath}`, started);
  return savePath;
}

/**
 * 对外入口：
 *  - 导航到视频明细页
 *  - 选择"自然日 - 昨天"
 *  - 确保在"视频明细"子 tab
 *  - 切换"投放属性 = 非投放"
 *  - 点击"下载明细"并保存
 *
 * 当传入 shopName 时，文件会落到 saveDir/<shopName>/ 目录下，
 * 便于同一个账号切换多店铺时按店铺归档。
 *
 * 每一步独立容错，总体失败会抛异常并由上层截图记录。
 *
 * @param {import('playwright').Page} page
 * @param {{ tag: string, saveDir: string, shopName?: string }} options
 */
async function downloadVideoSelfDetail(page, { tag, saveDir, shopName }) {
  const startedAll = Date.now();
  logStep(tag, `下载开始，目标店铺: ${shopName || "(未指定)"}`);

  await gotoVideoSelf(page, tag);
  await selectDateRangeYesterday(page, tag);
  await ensureVideoDetailTab(page, tag);
  await selectNonAdTab(page, tag);

  // 给表格一个 loading → 刷新完成的缓冲；实测切换 tab + 改 date 后需要重新拉数据
  await page.waitForTimeout(1200);

  const targetDir = shopName
    ? path.join(saveDir, safeShopDirName(shopName))
    : saveDir;
  const savePath = await clickDownloadAndSave(page, tag, targetDir);

  logStep(tag, `下载流程完成`, startedAll);
  return { savePath };
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
  safeShopDirName
};
