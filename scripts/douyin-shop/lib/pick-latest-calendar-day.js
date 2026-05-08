/**
 * 罗盘 ecom-picker：在已展开的自然日面板中点击「可选日期里 DOM 序最后一个」。
 * dayOffset=0 点最后一个（最新一天），dayOffset=1 点倒数第二个，以此类推。
 * 支持跨月导航——当月可选日期不够时自动翻到上月。
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

  let remainingOffset = dayOffset;

  for (let monthHop = 0; monthHop < 6; monthHop++) {
    const yearMonth = await readCalendarYearMonth(scope);

    const inViewCells = scope.locator(
      "td.ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
    );
    let count = await inViewCells.count().catch(() => 0);

    // Fallback: any non-disabled cells
    if (count === 0) {
      const anyCells = scope.locator(
        "td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
      );
      count = await anyCells.count().catch(() => 0);
    }

    if (count > 0 && count - 1 >= remainingOffset) {
      // This month has enough selectable days
      const idx = count - 1 - remainingOffset;

      let target;
      if (inViewCells && (await inViewCells.count().catch(() => 0)) > 0) {
        target = inViewCells.nth(idx);
      } else {
        const anyCells = scope.locator(
          "td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
        );
        target = anyCells.nth(idx);
      }

      const dayStr = (await target.innerText().catch(() => "")).trim();
      const day = parseInt(dayStr, 10);
      await target.click({ timeout: 2000 }).catch(() => {});

      let dataDate = null;
      if (yearMonth && Number.isFinite(day) && day >= 1 && day <= 31) {
        const { y, mo } = yearMonth;
        dataDate = `${y}/${String(mo).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
      }
      return { ok: true, dataDate };
    }

    // Not enough days — go to previous month
    remainingOffset = Math.max(0, remainingOffset - Math.max(count, 1));

    const prevClicked = await clickPrevMonthBtn(scope);
    if (!prevClicked) {
      // Can't navigate further — pick whatever is available
      if (count > 0) {
        const idx = count - 1;
        let target;
        if (inViewCells && (await inViewCells.count().catch(() => 0)) > 0) {
          target = inViewCells.nth(idx);
        } else {
          const anyCells = scope.locator(
            "td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
          );
          target = anyCells.nth(idx);
        }
        const dayStr = (await target.innerText().catch(() => "")).trim();
        const day = parseInt(dayStr, 10);
        await target.click({ timeout: 2000 }).catch(() => {});

        let dataDate = null;
        if (yearMonth && Number.isFinite(day) && day >= 1 && day <= 31) {
          const { y, mo } = yearMonth;
          dataDate = `${y}/${String(mo).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
        }
        return { ok: true, dataDate };
      }
      return { ok: false, dataDate: null };
    }

    await page.waitForTimeout(300);
  }

  return { ok: false, dataDate: null };
}

/**
 * Click the previous-month button in the calendar header
 * @param {import('playwright').Locator} scope
 * @returns {Promise<boolean>} true if successfully clicked
 */
async function clickPrevMonthBtn(scope) {
  const prevSelectors = [
    '.ecom-picker-header-prev-btn',
    '.ecom-picker-super-prev-btn',
    'button.ecom-picker-header-btn:first-of-type',
    '.ecom-picker-header button:first-of-type',
    '[class*="prev"]',
    '.ecom-picker-header button svg', // fallback: first svg icon button in header
  ];

  for (const sel of prevSelectors) {
    const btn = scope.locator(sel).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click({ timeout: 2000 }).catch(() => {});
      return true;
    }
  }

  // Last resort: find buttons in header and click the first one (prev month)
  const headerBtns = scope.locator('.ecom-picker-header button');
  const btnCount = await headerBtns.count().catch(() => 0);
  if (btnCount >= 2) {
    await headerBtns.nth(0).click({ timeout: 2000 }).catch(() => {});
    return true;
  }

  return false;
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
