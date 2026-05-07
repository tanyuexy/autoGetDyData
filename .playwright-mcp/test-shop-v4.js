const { chromium } = require("/Users/xy/code/tool/autoGetDyData/node_modules/playwright");
const STORAGE = "/Users/xy/code/tool/autoGetDyData/storage/shop-accounts/lianou_rpa@163.com/storageState.json";

async function runTest(round) {
  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    acceptDownloads: true,
    storageState: STORAGE
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const checkpoints = {};

  try {
    console.log("\n========== Round " + round + " ==========");

    // Step 1: Shop picker
    console.log("[R" + round + "] Opening shop picker...");
    await page.goto("https://fxg.jinritemai.com/login/common", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);
    const roleItem = page.locator("[class*=roleItem]").first();
    if (await roleItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      const name = await roleItem.locator("[class*=introName]").first().textContent().catch(() => "?");
      console.log("[R" + round + "] Selected: " + name);
      await roleItem.click({ timeout: 5000 });
      await page.waitForTimeout(5000);
    }
    checkpoints.pickShop = Date.now() - t0;

    // Step 2: Go to compass video self
    console.log("[R" + round + "] Going to compass video/self...");
    await page.goto("https://compass.jinritemai.com/shop/video/self", { waitUntil: "domcontentloaded", timeout: 20000 });
    // Wait for key element to appear
    await page.locator(":has-text('自营视频')").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    checkpoints.pageLoaded = Date.now() - t0;

    // Step 3: Check page elements
    const hasDownloadBtn = await page.locator("button:has-text('下载明细')").count().catch(() => 0);
    const hasMore = await page.locator("label:has-text('更多')").first().isVisible({ timeout: 3000 }).catch(() => false);
    const hasNatural = await page.locator("label:has-text('自然日')").first().isVisible({ timeout: 2000 }).catch(() => false);
    const hasRealTime = await page.locator("label:has-text('实时')").first().isVisible({ timeout: 2000 }).catch(() => false);

    console.log("[R" + round + "] Download: " + hasDownloadBtn + " | More: " + hasMore + " | Natural: " + hasNatural + " | RealTime: " + hasRealTime);

    // Step 4: Click "更多" to open date range dropdown
    if (hasMore) {
      console.log("[R" + round + "] Clicking '更多'...");
      const moreLabel = page.locator("label:has-text('更多')").first();
      await moreLabel.click({ timeout: 2000 });
      await page.waitForTimeout(600);

      // Check if dropdown opened
      const dropdownVisible = await page.locator(".ecom-dorami-date-picker-quick-picker-dropdown").first().isVisible({ timeout: 2000 }).catch(() => false);
      console.log("[R" + round + "] Dropdown visible: " + dropdownVisible);

      if (dropdownVisible) {
        // Find "自然日" in dropdown
        const naturalItem = page.locator(".ecom-dorami-date-picker-quick-picker-dropdown li:has-text('自然日'), .ecom-dorami-date-picker-quick-picker-dropdown :has-text('自然日')").first();
        const natVisible = await naturalItem.isVisible({ timeout: 2000 }).catch(() => false);
        console.log("[R" + round + "] Natural day option: " + natVisible);

        if (natVisible) {
          await naturalItem.click({ timeout: 2000 });
          await page.waitForTimeout(800);

          // Check calendar picker
          const hasCalendar = await page.locator(".ecom-picker-body").first().isVisible({ timeout: 3000 }).catch(() => false);
          console.log("[R" + round + "] Calendar visible: " + hasCalendar);

          if (hasCalendar) {
            // Count selectable days
            const cells = page.locator("td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner");
            const cellCount = await cells.count().catch(() => 0);
            console.log("[R" + round + "] Selectable days: " + cellCount);

            // Click the last selectable day (latest date)
            if (cellCount > 0) {
              const lastCell = cells.nth(cellCount - 1);
              const day = await lastCell.innerText().catch(() => "?");
              console.log("[R" + round + "] Clicking day: " + day);
              await lastCell.click({ timeout: 2000 });
              await page.waitForTimeout(800);

              // Close popup
              await page.keyboard.press("Escape").catch(() => {});
              await page.waitForTimeout(500);
              checkpoints.calendarClicked = Date.now() - t0;
            }
          }
        }
      }
    }

    // Step 5: Check download button after date selection
    if (hasDownloadBtn > 0) {
      const btn = page.locator("button:has-text('下载明细')").first();
      const enabled = await btn.isEnabled().catch(() => false);
      const visible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
      console.log("[R" + round + "] Download btn: enabled=" + enabled + " visible=" + visible);
      checkpoints.downloadChecked = Date.now() - t0;

      // Click download (triggers download but we cancel)
      if (enabled && visible) {
        console.log("[R" + round + "] Triggering download...");
        const downloadPromise = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
        try {
          await btn.click({ timeout: 3000 });
          const download = await downloadPromise;
          if (download) {
            const fname = download.suggestedFilename();
            await download.cancel();
            console.log("[R" + round + "] Download triggered: " + fname);
          }
        } catch (e) {
          console.log("[R" + round + "] Download event: " + e.message.slice(0, 80));
        }
        checkpoints.downloadDone = Date.now() - t0;
      }
    }

    const elapsed = Date.now() - t0;
    console.log("[R" + round + "] Total: " + elapsed + "ms");

    return {
      round, success: true,
      hasDownloadBtn, hasMore, hasNatural, hasRealTime,
      elapsed, checkpoints
    };

  } catch (err) {
    console.error("[R" + round + "] Error: " + err.message);
    return { round, success: false, error: err.message };
  } finally {
    await ctx.close();
    await browser.close();
  }
}

(async () => {
  const results = [];
  for (let r = 1; r <= 3; r++) {
    results.push(await runTest(r));
  }

  console.log("\n========== 3-Round Results ==========");
  console.log("R | Success | Download | More | Natural | Time");
  results.forEach(function(r) {
    console.log("R" + r.round + " | " + r.success + " | " + r.hasDownloadBtn + " | " + r.hasMore + " | " + r.hasNatural + " | " + r.elapsed + "ms");
    if (r.checkpoints) console.log("  Checkpoints: " + JSON.stringify(r.checkpoints));
  });

  const allSuccess = results.every(r => r.success);
  const allDownload = results.every(r => r.hasDownloadBtn > 0);
  const allMore = results.every(r => r.hasMore);
  console.log("\nAll success: " + allSuccess + " | All download: " + allDownload + " | All more: " + allMore);
})();
