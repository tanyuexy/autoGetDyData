/**
 * 罗盘 ecom-picker：在已展开的自然日面板中点击「可选日期里 DOM 序最后一个」。
 * dayOffset=0 点最后一个（最新一天），dayOffset=1 点倒数第二个，以此类推。
 * 并尝试解析年月日，格式化为 YYYY/MM/DD。
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} [scopeRoot] 限定在右侧面板；缺省为 page
 * @param {number} [dayOffset=0] 从最新日期往前的偏移量
 * @returns {Promise<{ ok: boolean, dataDate: string | null }>}
 */
async function pickLatestSelectableCalendarDay(page, scopeRoot, dayOffset = 0) {
  const scope = scopeRoot || page;

  await page
    .locator(".ecom-picker-body")
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {});

  const yearMonth = await readCalendarYearMonth(scope);

  const inViewCells = scope.locator(
    "td.ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
  );
  let count = await inViewCells.count().catch(() => 0);
  let target = null;
  if (count > 0) {
    const idx = Math.max(0, count - 1 - dayOffset);
    target = inViewCells.nth(idx);
  } else {
    const anyCells = scope.locator(
      "td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
    );
    count = await anyCells.count().catch(() => 0);
    if (count > 0) {
      const idx = Math.max(0, count - 1 - dayOffset);
      target = anyCells.nth(idx);
    }
  }

  if (!target) {
    return { ok: false, dataDate: null };
  }

  const dayStr = (await target.innerText().catch(() => "")).trim();
  const day = parseInt(dayStr, 10);

  await target.click({ timeout: 2000 }).catch(() => {});

  let dataDate = null;
  if (
    yearMonth &&
    Number.isFinite(day) &&
    day >= 1 &&
    day <= 31
  ) {
    const { y, mo } = yearMonth;
    dataDate = `${y}/${String(mo).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
  }

  return { ok: true, dataDate };
}

/**
 * @param {import('playwright').Locator} scope
 * @returns {Promise<{ y: number, mo: number } | null>}
 */
async function readCalendarYearMonth(scope) {
  const header = scope.locator(".ecom-picker-header").first();
  const text = (await header.innerText().catch(() => "")).trim();
  const compact = text.replace(/\s+/g, " ");
  let m = compact.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (m) {
    return { y: +m[1], mo: +m[2] };
  }
  m = compact.match(/(\d{4})\s*[年.\/-]\s*(\d{1,2})/);
  if (m) {
    return { y: +m[1], mo: +m[2] };
  }
  return null;
}

module.exports = { pickLatestSelectableCalendarDay, readCalendarYearMonth };
