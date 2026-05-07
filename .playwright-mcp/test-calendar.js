const { chromium } = require("/Users/xy/code/tool/autoGetDyData/node_modules/playwright");
const STORAGE = "/Users/xy/code/tool/autoGetDyData/storage/shop-accounts/lianou_rpa@163.com/storageState.json";

const SCREENSHOT = "/Users/xy/code/tool/autoGetDyData/.playwright-mcp/";

(async () => {
  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    acceptDownloads: true,
    storageState: STORAGE
  });
  const page = await ctx.newPage();

  // Step 1: Shop picker
  await page.goto("https://fxg.jinritemai.com/login/common", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  const roleItem = page.locator("[class*=roleItem]").first();
  await roleItem.click({ timeout: 5000 });
  await page.waitForTimeout(5000);

  // Step 2: Go to compass video self
  await page.goto("https://compass.jinritemai.com/shop/video/self", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator(":has-text('自营视频')").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.screenshot({ path: SCREENSHOT + "cal-01-overview.png" });

  // === TEST 1: Explore the "更多" dropdown deeply ===
  console.log("\n=== TEST 1: Exploring '更多' dropdown ===");

  // Click the more label
  const moreLabel = page.locator("label:has-text('更多')").first();
  console.log("Clicking '更多' label...");
  await moreLabel.click({ timeout: 2000 });
  await page.waitForTimeout(1000);

  // Check what appeared
  const dropdown = page.locator(".ecom-dorami-date-picker-quick-picker-dropdown").first();
  const ddVisible = await dropdown.isVisible({ timeout: 2000 }).catch(() => false);
  console.log("Dropdown visible:", ddVisible);

  if (ddVisible) {
    // Dump ALL text inside the dropdown
    const ddText = await dropdown.innerText().catch(() => "");
    console.log("Dropdown content:\n" + ddText);

    // Find ALL li elements in dropdown
    const items = await dropdown.locator("li").allTextContents().catch(() => []);
    console.log("\nLI items:", items);

    // Check for calendar elements after clicking "自然日"
    const naturalItem = dropdown.locator("li:has-text('自然日')").first();
    const natVisible = await naturalItem.isVisible({ timeout: 2000 }).catch(() => false);
    console.log("\n'自然日' item visible:", natVisible);

    if (natVisible) {
      console.log("Clicking '自然日'...");
      await naturalItem.click({ timeout: 2000 });
      await page.waitForTimeout(1000);

      // Check what changed after clicking
      const ddAfterText = await page.locator(".ecom-dorami-date-picker-quick-picker-dropdown").first().innerText().catch(() => "");
      console.log("\nDropdown after clicking '自然日':\n" + ddAfterText);

      // Check for calendar picker body
      const pickerBody = page.locator(".ecom-picker-body").first();
      const pickerVisible = await pickerBody.isVisible({ timeout: 3000 }).catch(() => false);
      console.log("\necom-picker-body visible:", pickerVisible);

      // Check for date picker panel (alternative class names)
      const datePickerPanel = page.locator(".ecom-date-picker-panel, .ecom-picker-panel-container, .ecom-dorami-date-picker-right-container").first();
      const panelVisible = await datePickerPanel.isVisible({ timeout: 2000 }).catch(() => false);
      console.log("date-picker-panel visible:", panelVisible);

      // Check for ANY calendar-like element
      const anyCalendar = page.locator("[class*=picker], [class*=calendar], [class*=datepicker]").first();
      const anyCalendarTexts = await anyCalendar.allInnerTexts().catch(() => []);
      console.log("\nAny calendar elements count:", anyCalendarTexts.length);

      // The calendar might be inside the dropdown itself, not a separate panel
      const cellsInDropdown = dropdown.locator("td, [class*=cell]").first();
      const cellsVisible = await cellsInDropdown.isVisible({ timeout: 1000 }).catch(() => false);
      console.log("Calendar cells inside dropdown:", cellsVisible);

      // Let's do a full page dump to find where the calendar is
      console.log("\n=== Full page search for calendar ===");
      
      // Check if clicking "自然日" changed the dropdown content to include a calendar
      const ddContent = await dropdown.innerHTML().catch(() => "");
      const hasCalendarInDropdown = ddContent.includes("ecom-picker") || ddContent.includes("picker-cell");
      console.log("Has calendar inside dropdown HTML:", hasCalendarInDropdown);
      
      // Try looking for the quick picker dropdown children
      const ddChildren = dropdown.locator("> *");
      const ddChildCount = await ddChildren.count().catch(() => 0);
      console.log("Dropdown direct children:", ddChildCount);
      
      for (let i = 0; i < Math.min(ddChildCount, 10); i++) {
        const cls = await ddChildren.nth(i).getAttribute("class").catch(() => "");
        const tag = await ddChildren.nth(i).evaluate(el => el.tagName).catch(() => "");
        console.log("  Child " + i + ":", tag, cls.slice(0, 80));
      }
      
      // Try: maybe the dropdown expands side panel with calendar
      const allPanels = page.locator("[class*=picker-panel], [class*=picker-container], [class*=picker-body]");
      const panelCount = await allPanels.count().catch(() => 0);
      console.log("\nPicker panels on page:", panelCount);
      
      for (let i = 0; i < panelCount; i++) {
        const visible = await allPanels.nth(i).isVisible({timeout:500}).catch(()=>false);
        const cls = await allPanels.nth(i).getAttribute("class").catch(()=>"");
        console.log("  Panel " + i + ": visible=" + visible, cls.slice(0, 80));
      }

      await page.screenshot({ path: SCREENSHOT + "cal-02-after-natural-day.png" });

      // === TEST 2: Try navigating the date picker if calendar is found ===
      if (pickerVisible || panelVisible) {
        console.log("\n=== TEST 2: Calendar navigation ===");
        
        const scope = pickerVisible ? pickerBody : datePickerPanel;
        
        // Check prev month button
        const prevBtn = scope.locator(".ecom-picker-header-prev-btn, .ecom-picker-super-prev-btn, .ecom-picker-header button:first-of-type").first();
        const prevVisible = await prevBtn.isVisible({ timeout: 1000 }).catch(() => false);
        console.log("Prev month btn visible:", prevVisible);

        // Read current month
        const header = scope.locator(".ecom-picker-header").first();
        const headerText = await header.innerText({ timeout: 1000 }).catch(() => "");
        console.log("Current header:", headerText);

        // Count selectable cells
        const cells = scope.locator("td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner");
        const cellCount = await cells.count().catch(() => 0);
        console.log("Selectable cells:", cellCount);

        // Click prev month and verify
        if (prevVisible && cellCount > 0) {
          console.log("\n=== TEST 3: Cross-month navigation ===");
          
          for (let hop = 1; hop <= 2; hop++) {
            await prevBtn.click({ timeout: 2000 });
            await page.waitForTimeout(500);
            const newHeader = await header.innerText({ timeout: 1000 }).catch(() => "");
            const newCells = await scope.locator("td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner").count().catch(() => 0);
            console.log("Hop " + hop + ": header=" + newHeader, "cells=" + newCells);
          }

          // Click a cell
          const lastCell = scope.locator("td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner").nth(-1);
          const day = await lastCell.innerText({ timeout: 1000 }).catch(() => "");
          await lastCell.click({ timeout: 2000 });
          console.log("Clicked day:", day);
          
          await page.screenshot({ path: SCREENSHOT + "cal-03-cross-month.png" });
        }
      } else {
        // Calendar not visible - maybe natural day click changed the label text instead
        console.log("\n=== TEST 2 Alternative: Check if 'natural day' just changes filter ===");
        
        // Maybe the page uses a different interaction model
        // Try: clicking "更多" shows a simple dropdown, clicking "自然日" just changes the filter label
        // without opening a calendar. The actual date range might be managed differently.
        
        const allVisibleTexts = await page.locator("label, span").allTextContents().catch(() => []);
        const filtered = allVisibleTexts.filter(t => t && t.trim().length > 0).slice(0, 30);
        console.log("Visible labels:", filtered.join(" | "));
      }
    }
  }

  // Close dropdown
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);

  // === TEST 4: Try the download button with current date selections ===
  console.log("\n=== TEST 4: Download button test ===");
  const downloadBtns = page.locator("button:has-text('下载明细')");
  const btnCount = await downloadBtns.count().catch(() => 0);
  console.log("Download buttons:", btnCount);

  if (btnCount > 0) {
    const btn = downloadBtns.first();
    const isEnabled = await btn.isEnabled().catch(() => false);
    console.log("Button enabled:", isEnabled);

    if (isEnabled) {
      console.log("Triggering download...");
      const dlPromise = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
      await btn.click({ timeout: 3000 });
      const dl = await dlPromise;
      if (dl) {
        console.log("Download triggered:", dl.suggestedFilename());
        await dl.cancel();
      } else {
        console.log("No download event within 10s");
      }
    }
  }

  await page.screenshot({ path: SCREENSHOT + "cal-04-final.png" });
  console.log("\n=== Tests complete ===");

  await ctx.close();
  await browser.close();
})();
