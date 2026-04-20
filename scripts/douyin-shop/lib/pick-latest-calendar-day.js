/**
 * 罗盘 ecom-picker：在已展开的自然日面板中点击「可选日期里 DOM 序最后一个」，
 * 与业务上「最新一个可选自然日」一致（多为 T+1 可导出的最近一天）。
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} [scopeRoot] 限定在右侧面板；缺省为 page
 * @returns {Promise<boolean>}
 */
async function pickLatestSelectableCalendarDay(page, scopeRoot) {
  const scope = scopeRoot || page;

  await page
    .locator(".ecom-picker-body")
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {});

  const inViewCells = scope.locator(
    "td.ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
  );
  let count = await inViewCells.count().catch(() => 0);
  if (count > 0) {
    await inViewCells.nth(count - 1).click({ timeout: 2000 }).catch(() => {});
    return true;
  }

  const anyCells = scope.locator(
    "td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
  );
  count = await anyCells.count().catch(() => 0);
  if (count > 0) {
    await anyCells.nth(count - 1).click({ timeout: 2000 }).catch(() => {});
    return true;
  }

  return false;
}

module.exports = { pickLatestSelectableCalendarDay };
