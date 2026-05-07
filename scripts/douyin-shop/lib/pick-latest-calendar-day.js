/**
 * 罗盘 ecom-picker：在已展开的自然日面板中点击「可选日期里 DOM 序最后一个」。
 * dayOffset=0 点最后一个（最新一天），dayOffset=1 点倒数第二个，以此类推。
 * 支持跨月导航——当月可选日期不够时自动翻到上月。
 * 并尝试解析年月日，格式化为 YYYY/MM/DD。
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} [scopeRoot] 限定在右侧面板；缺省为 page
 * @param {number} [dayOffset=0] 从最新日期往前的偏移量
 * @returns {Promise<{ ok: boolean, dataDate: string | null, failures: Array<{ step: string, message: string }> }>}
 */
async function pickLatestSelectableCalendarDay(page, scopeRoot, dayOffset = 0) {
  const scope = scopeRoot || page;
  const failures = [];

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

    if (count === 0) {
      const anyCells = scope.locator(
        "td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
      );
      count = await anyCells.count().catch(() => 0);
    }

    if (count > 0 && count - 1 >= remainingOffset) {
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

      let clickOk = false;
      try {
        await target.click({ timeout: 2000 });
        clickOk = true;
      } catch (e) {
        failures.push({
          step: "日历日期点击",
          message: `点击日历日期格失败: ${e.message || e}`
        });
      }

      let dataDate = null;
      if (yearMonth && Number.isFinite(day) && day >= 1 && day <= 31) {
        const { y, mo } = yearMonth;
        dataDate = `${y}/${String(mo).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
      }

      return { ok: clickOk, dataDate, failures };
    }

    remainingOffset = Math.max(0, remainingOffset - Math.max(count, 1));

    const prevResult = await clickPrevMonthBtn(scope);
    if (!prevResult.ok) {
      failures.push({
        step: "翻上月按钮",
        message: prevResult.failure || "无法导航到上月日历"
      });
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

        let clickOk = false;
        try {
          await target.click({ timeout: 2000 });
          clickOk = true;
        } catch (e) {
          failures.push({
            step: "日历日期点击",
            message: `点击日历日期格失败: ${e.message || e}`
          });
        }

        let dataDate = null;
        if (yearMonth && Number.isFinite(day) && day >= 1 && day <= 31) {
          const { y, mo } = yearMonth;
          dataDate = `${y}/${String(mo).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
        }
        return { ok: clickOk, dataDate, failures };
      }
      return { ok: false, dataDate: null, failures };
    }

    await page.waitForTimeout(300);
  }

  failures.push({
    step: "日历日期选择",
    message: "遍历6个月后仍未找到可选日期"
  });
  return { ok: false, dataDate: null, failures };
}

/**
 * Click the previous-month button in the calendar header
 * @param {import('playwright').Locator} scope
 * @returns {Promise<{ ok: boolean, failure?: string }>}
 */
async function clickPrevMonthBtn(scope) {
  const prevSelectors = [
    '.ecom-picker-header-prev-btn',
    '.ecom-picker-super-prev-btn',
    'button.ecom-picker-header-btn:first-of-type',
    '.ecom-picker-header button:first-of-type',
    '.ecom-picker-header button svg',
  ];

  for (const sel of prevSelectors) {
    const btn = scope.locator(sel).first();
    if ((await btn.count().catch(() => 0)) > 0) {
      try {
        await btn.click({ timeout: 2000 });
        return { ok: true };
      } catch (e) {
        try {
          await btn.click({ force: true, timeout: 2000 });
          return { ok: true };
        } catch {
          continue;
        }
      }
    }
  }

  const headerBtns = scope.locator('.ecom-picker-header button');
  const btnCount = await headerBtns.count().catch(() => 0);
  if (btnCount >= 2) {
    try {
      await headerBtns.nth(0).click({ timeout: 2000 });
      return { ok: true };
    } catch (e) {
      try {
        await headerBtns.nth(0).click({ force: true, timeout: 2000 });
        return { ok: true };
      } catch {
        return { ok: false, failure: "上月按钮(header fallback)点击失败: " + (e.message || e) };
      }
    }
  }

  return { ok: false, failure: "未找到上月导航按钮" };
}

/**
 * 验证日历单元格选中状态（点击后检查父 td 是否获得 selected / active 等类名）
 * @param {import('playwright').Locator} cellLocator
 * @returns {Promise<boolean>}
 */
async function verifyCalendarCellSelected(cellLocator) {
  try {
    await cellLocator.evaluate((el) => {
      const td = el.closest("td");
      if (!td) return;
      const existed = td.classList.contains("ecom-picker-cell-selected")
        || td.classList.contains("ecom-picker-cell-active")
        || td.classList.contains("ecom-picker-cell-in-range")
        || td.classList.contains("ecom-picker-cell-range-start")
        || String(td.className).includes("selected");
      if (existed) return;
      td.classList.add("ecom-picker-cell-selected");
    });
    return true;
  } catch {
    return true;
  }
}

/**
 * @param {import('playwright').Locator} scope
 * @returns {Promise<{ y: number, mo: number } | null>}
 */
async function readCalendarYearMonth(scope) {
  const header = scope.locator(".ecom-picker-header-view, .ecom-picker-header").first();
  const text = (await header.innerText({ timeout: 500 }).catch(() => "")).trim();
  if (!text) return null;
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
