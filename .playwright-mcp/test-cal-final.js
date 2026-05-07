const { chromium } = require("/Users/xy/code/tool/autoGetDyData/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    storageState: "/Users/xy/code/tool/autoGetDyData/storage/shop-accounts/lianou_rpa@163.com/storageState.json"
  });
  const page = await ctx.newPage();

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

  console.log("=== Cell class analysis ===\n");

  // Get ALL td cells with their full class and disabled state
  const allTds = dd.locator("td.ecom-picker-cell");
  const tdCount = await allTds.count().catch(() => 0);
  console.log("Total TD.ecom-picker-cell:", tdCount);

  let hasInView = 0;
  let hasDisabled = 0;
  let hasBoth = 0;
  let hasNeither = 0;

  for (let i = 0; i < tdCount; i++) {
    const cls = (await allTds.nth(i).getAttribute("class").catch(() => "")) || "";
    const text = (await allTds.nth(i).innerText().catch(() => "")).trim();
    const inView = cls.includes("in-view") || cls.includes("inView");
    const disabled = cls.includes("disabled");
    const isInFuture = text === "" || parseInt(text) > 15; // May dates beyond mid-month

    if (inView && disabled) hasBoth++;
    else if (inView) hasInView++;
    else if (disabled) hasDisabled++;
    else hasNeither++;

    if (i < 5 || disabled || inView) {
      console.log("  [" + i + "] text='" + text + "' class=" + cls.slice(0, 100) + 
        " inView=" + inView + " disabled=" + disabled);
    }
  }

  console.log("\ninView+disabled:", hasBoth);
  console.log("inView only:", hasInView);
  console.log("disabled only:", hasDisabled);
  console.log("neither:", hasNeither);

  // Test the code's selector directly
  console.log("\n=== Code selector test ===");
  const scope = dd.locator(".ecom-dorami-date-picker-right-container, .ecom-picker-panel-container").first();
  
  // Original selector
  const sel1 = "td.ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner";
  const count1 = await scope.locator(sel1).count().catch(() => 0);
  console.log("Code selector matches:", count1);

  // Fallback selector
  const sel2 = "td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner";
  const count2 = await scope.locator(sel2).count().catch(() => 0);
  console.log("Fallback selector matches:", count2);

  // What actually works?
  const sel3 = "td.ecom-picker-cell .ecom-picker-cell-inner";
  const count3 = await scope.locator(sel3).count().catch(() => 0);
  console.log("All cells (any):", count3);

  // Test clicking via the code's approach
  console.log("\n=== Click test via code's approach ===");
  if (count1 > 0) {
    console.log("Using primary selector with", count1, "matches");
  } else if (count2 > 0) {
    console.log("Using fallback selector with", count2, "matches");
    const cells = scope.locator(sel2);
    const n = await cells.count();
    // Click the last one
    const last = cells.nth(n - 1);
    const lastText = await last.innerText().catch(() => "");
    console.log("Clicking last enabled cell:", lastText);
    await last.click({ timeout: 2000 });
    await page.waitForTimeout(500);
    console.log("Clicked! Now checking download button...");
    
    // Close dropdown
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
  }

  // Test download after calendar click
  const downloadBtns = page.locator("button:has-text('下载明细')");
  const btnCount = await downloadBtns.count().catch(() => 0);
  if (btnCount > 0) {
    console.log("\nDownload buttons:", btnCount);
    const btn = downloadBtns.first();
    const enabled = await btn.isEnabled().catch(() => false);
    console.log("Enabled:", enabled);
    if (enabled) {
      const dlPromise = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
      await btn.click({ timeout: 3000 });
      const dl = await dlPromise;
      if (dl) {
        console.log("Download:", dl.suggestedFilename());
        await dl.cancel();
      }
    }
  }

  await ctx.close();
  await browser.close();
})();
