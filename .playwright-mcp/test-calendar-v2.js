const { chromium } = require("/Users/xy/code/tool/autoGetDyData/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    acceptDownloads: true,
    storageState: "/Users/xy/code/tool/autoGetDyData/storage/shop-accounts/lianou_rpa@163.com/storageState.json"
  });
  const page = await ctx.newPage();
  const shot = "/Users/xy/code/tool/autoGetDyData/.playwright-mcp/";

  // Pick shop
  await page.goto("https://fxg.jinritemai.com/login/common", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.locator("[class*=roleItem]").first().click({ timeout: 5000 });
  await page.waitForTimeout(5000);

  // Go to compass
  await page.goto("https://compass.jinritemai.com/shop/video/self", { waitUntil: "domcontentloaded", timeout: 20000 });
  try { await page.locator("text=自营视频").first().waitFor({ state: "visible", timeout: 15000 }); } catch(e) {}
  await page.waitForTimeout(4000);

  console.log("=== Deep Calendar Structure Test ===\n");

  // Open dropdown
  console.log("1. Opening '更多' dropdown...");
  await page.locator("label").filter({ hasText: "更多" }).first().click({ timeout: 2000 });
  await page.waitForTimeout(800);

  // Click natural day
  console.log("2. Clicking '自然日'...");
  const dd = page.locator(".ecom-dorami-date-picker-quick-picker-dropdown").first();
  await dd.locator("li").filter({ hasText: "自然日" }).first().click({ timeout: 2000 });
  await page.waitForTimeout(1000);

  console.log("3. Analyzing calendar structure...\n");

  // The calendar is inside the dropdown
  // Dump the raw HTML structure to understand cell selector
  const html = await dd.innerHTML().catch(() => "");
  const calIndex = html.indexOf("picker");
  const snippet = calIndex >= 0 ? html.slice(Math.max(0, calIndex-100), calIndex+600) : html.slice(0, 800);
  console.log("HTML around 'picker':", snippet);

  // Check picker body
  const pickerBody = dd.locator(".ecom-picker-body").first();
  const pbVisible = await pickerBody.isVisible({ timeout: 500 }).catch(() => false);
  console.log("\necom-picker-body visible:", pbVisible);

  if (pbVisible) {
    const pbChildren = pickerBody.locator("> *");
    const pbCount = await pbChildren.count().catch(() => 0);
    console.log("picker-body children:", pbCount);

    for (let i = 0; i < pbCount; i++) {
      const tag = await pbChildren.nth(i).evaluate(el => el.tagName).catch(() => "?");
      const cls = (await pbChildren.nth(i).getAttribute("class").catch(() => "")) || "";
      console.log("  [" + i + "] <" + tag + "> class=" + cls.slice(0, 80));
    }

    // Find calendar cells
    const cells = pickerBody.locator("[class*=cell]");
    const cellCount = await cells.count().catch(() => 0);
    console.log("\nTotal [class*=cell]:", cellCount);

    if (cellCount > 0) {
      for (let i = 0; i < Math.min(cellCount, 5); i++) {
        const tag = await cells.nth(i).evaluate(el => el.tagName).catch(() => "?");
        const cls = (await cells.nth(i).getAttribute("class").catch(() => "")) || "";
        const text = (await cells.nth(i).innerText().catch(() => "")).trim();
        const disabled = await cells.nth(i).evaluate(el => el.closest("[class*=disabled]") !== null).catch(() => false);
        console.log("  Cell[" + i + "]: <" + tag + "> " + (disabled ? "[DISABLED] " : "") + "class=" + cls.slice(0, 100) + " text='" + text + "'");
      }

      // Count enabled vs disabled
      let enabled = 0;
      let disabled = 0;
      for (let i = 0; i < cellCount; i++) {
        const isDisabled = await cells.nth(i).evaluate(el => {
          return el.closest("[class*=disabled]") !== null || el.classList.contains("ecom-picker-cell-disabled");
        }).catch(() => true);
        if (isDisabled) disabled++; else enabled++;
      }
      console.log("\nEnabled cells:", enabled, "| Disabled cells:", disabled);

      // Click an enabled cell
      console.log("\n4. Clicking an enabled cell...");
      for (let i = cellCount - 1; i >= 0; i--) {
        const isDisabled = await cells.nth(i).evaluate(el => {
          return el.closest("[class*=disabled]") !== null || el.classList.contains("ecom-picker-cell-disabled") || el.closest("td.ecom-picker-cell-disabled") !== null;
        }).catch(() => true);
        if (!isDisabled) {
          const text = (await cells.nth(i).innerText().catch(() => "")).trim();
          console.log("  Clicking cell[" + i + "]: '" + text + "'");
          await cells.nth(i).click({ timeout: 2000 });
          await page.waitForTimeout(500);
          break;
        }
      }
    }
  }

  // Test cross-month: find and click prev month button
  console.log("\n5. Testing cross-month navigation...");
  const pickerHeader = dd.locator(".ecom-picker-header").first();
  const headerText = await pickerHeader.innerText({ timeout: 500 }).catch(() => "N/A");
  console.log("Header:", headerText);

  const prevBtn = dd.locator(".ecom-picker-header-prev-btn, .ecom-picker-super-prev-btn").first();
  const prevVisible = await prevBtn.isVisible({ timeout: 500 }).catch(() => false);
  console.log("Prev month btn visible:", prevVisible);

  if (prevVisible) {
    console.log("Clicking prev month...");
    await prevBtn.click({ timeout: 2000 });
    await page.waitForTimeout(500);
    const newHeader = await pickerHeader.innerText({ timeout: 500 }).catch(() => "N/A");
    console.log("New header:", newHeader);

    // Click again
    await prevBtn.click({ timeout: 2000 });
    await page.waitForTimeout(500);
    const header2 = await pickerHeader.innerText({ timeout: 500 }).catch(() => "N/A");
    console.log("2nd prev:", header2);
  }

  // Test: try the "近7天" quick select for comparison
  console.log("\n6. Testing quick select '近7天'...");
  await dd.locator("li").filter({ hasText: "近7天" }).first().click({ timeout: 2000 });
  await page.waitForTimeout(800);
  const afterQuick = await dd.innerText({ timeout: 500 }).catch(() => "");
  console.log("After '近7天', dropdown text:", afterQuick.slice(0, 200));

  await page.screenshot({ path: shot + "cal-deep.png" });
  console.log("\nScreenshot: cal-deep.png");

  await ctx.close();
  await browser.close();
})();
