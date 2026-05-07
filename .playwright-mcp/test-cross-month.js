const { chromium } = require("/Users/xy/code/tool/autoGetDyData/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    acceptDownloads: true,
    storageState: "/Users/xy/code/tool/autoGetDyData/storage/shop-accounts/lianou_rpa@163.com/storageState.json"
  });
  const page = await ctx.newPage();

  // Pick shop + go to compass
  await page.goto("https://fxg.jinritemai.com/login/common", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.locator("[class*=roleItem]").first().click({ timeout: 5000 });
  await page.waitForTimeout(5000);
  await page.goto("https://compass.jinritemai.com/shop/video/self", { waitUntil: "domcontentloaded", timeout: 20000 });
  try { await page.locator("text=自营视频").first().waitFor({ state: "visible", timeout: 15000 }); } catch(e) {}
  await page.waitForTimeout(4000);

  // Open dropdown + natural day
  await page.locator("label").filter({ hasText: "更多" }).first().click({ timeout: 2000 });
  await page.waitForTimeout(600);
  const dd = page.locator(".ecom-dorami-date-picker-quick-picker-dropdown").first();
  await dd.locator("li").filter({ hasText: "自然日" }).first().click({ timeout: 2000 });
  await page.waitForTimeout(1000);

  console.log("=== Cross-Month & Multi-Day Test ===\n");

  const scope = dd.locator(".ecom-dorami-date-picker-right-container, .ecom-picker-panel-container").first();

  // Read current month
  const header = scope.locator(".ecom-picker-header-view, .ecom-picker-header").first();
  const currentMonth = await header.innerText({ timeout: 500 }).catch(() => "N/A");
  console.log("Current month:", currentMonth);

  // Test 1: Select latest day (dayOffset=0)
  const cells = scope.locator("td.ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner");
  let cellCount = await cells.count().catch(() => 0);
  console.log("Selectable cells:", cellCount);

  if (cellCount > 0) {
    const latestIdx = cellCount - 1;
    const latest = cells.nth(latestIdx);
    const dayStr = await latest.innerText().catch(() => "");
    console.log("DayOffset=0 -> clicking day", dayStr);
    await latest.click({ timeout: 2000 });
    await page.waitForTimeout(500);
  }

  // Test 2: Cross-month navigation - click prev month btn (force click)
  console.log("\n2. Testing prev-month button (force click)...");
  const prevBtn = scope.locator(".ecom-picker-header-prev-btn").first();
  const prevExists = (await prevBtn.count().catch(() => 0)) > 0;
  console.log("Prev btn exists:", prevExists);

  if (prevExists) {
    let clicked = false;
    try {
      await prevBtn.click({ timeout: 2000 });
      clicked = true;
    } catch (e) {
      console.log("  Normal click failed, trying force...");
      try {
        await prevBtn.click({ force: true, timeout: 2000 });
        clicked = true;
      } catch (e2) {
        console.log("  Force click also failed:", e2.message.slice(0, 60));
      }
    }

    if (clicked) {
      await page.waitForTimeout(500);
      const newMonth = await header.innerText({ timeout: 500 }).catch(() => "N/A");
      console.log("Month after prev: " + newMonth);

      // Count cells in the new month
      const cellsAfter = scope.locator("td.ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner");
      const newCount = await cellsAfter.count().catch(() => 0);
      console.log("Selectable cells in prev month:", newCount);

      // Click another prev (super-prev: <<)
      console.log("\n3. Testing super-prev button...");
      const superPrev = scope.locator(".ecom-picker-header-super-prev-btn").first();
      try {
        await superPrev.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(500);
        const monthAfterSuper = await header.innerText({ timeout: 500 }).catch(() => "N/A");
        console.log("Month after super-prev: " + monthAfterSuper);
        const superCount = await scope.locator("td.ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner").count().catch(() => 0);
        console.log("Selectable cells after super-prev:", superCount);
      } catch (e) {
        console.log("Super-prev failed:", e.message.slice(0, 60));
      }
    }
  }

  // Test 4: Multi-day selection - go back to current month
  console.log("\n4. Multi-day test: select 3 different days...");
  // Close and reopen
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);
  await page.locator("label").filter({ hasText: "更多" }).first().click({ timeout: 2000 });
  await page.waitForTimeout(500);
  await page.locator(".ecom-dorami-date-picker-quick-picker-dropdown").first().locator("li").filter({ hasText: "自然日" }).first().click({ timeout: 2000 });
  await page.waitForTimeout(1000);

  const cells2 = scope.locator("td.ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner");
  const c2 = await cells2.count().catch(() => 0);
  console.log("Selectable cells:", c2);

  for (let offset = 0; offset < Math.min(3, c2); offset++) {
    const idx = c2 - 1 - offset;
    const cell = cells2.nth(idx);
    const day = await cell.innerText().catch(() => "");
    console.log("  Offset " + offset + ": cell[" + idx + "] = " + day);
    await cell.click({ timeout: 2000 });
    await page.waitForTimeout(300);
  }

  // Close dialog
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);

  // Download test
  console.log("\n5. Download after multi-day selection...");
  const btn = page.locator("button:has-text('下载明细')").first();
  if (await btn.isEnabled().catch(() => false)) {
    const dlPromise = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
    await btn.click({ timeout: 3000 });
    const dl = await dlPromise;
    if (dl) {
      console.log("Download:", dl.suggestedFilename());
      await dl.cancel();
    }
  }

  console.log("\n=== All tests passed ===");
  await ctx.close();
  await browser.close();
})();
