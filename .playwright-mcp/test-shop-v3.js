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

  try {
    console.log("\n========== Round " + round + " ==========");

    // Step 1: Navigate to login page (with cookies, shows shop picker)
    console.log("[R" + round + "] Opening...");
    await page.goto("https://fxg.jinritemai.com/login/common", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const isShopPicker = bodyText.includes("请选择店铺");
    console.log("[R" + round + "] Shop picker: " + isShopPicker);

    // Step 2: Click the first shop to enter workspace
    if (isShopPicker) {
      console.log("[R" + round + "] Selecting first shop...");
      const firstRoleItem = page.locator('[class*="roleItem"]').first();
      if (await firstRoleItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        const nameEl = firstRoleItem.locator('[class*="introName"]').first();
        const shopName = await nameEl.textContent({ timeout: 1000 }).catch(() => "?");
        console.log("[R" + round + "] Clicking shop: " + shopName);
        await firstRoleItem.click({ timeout: 5000 });
      } else {
        // Fallback: click first shop link
        const firstShop = page.locator(':has-text("抖店工作台")').first();
        if (await firstShop.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log("[R" + round + "] Clicking workspace entry...");
          await firstShop.click({ timeout: 3000 });
        }
      }
      await page.waitForTimeout(5000);
      console.log("[R" + round + "] URL after pick: " + page.url());
    } else {
      console.log("[R" + round + "] URL: " + page.url());
    }

    // Step 3: Navigate to compass video self
    console.log("[R" + round + "] Navigating to compass video/self...");
    await page.goto("https://compass.jinritemai.com/shop/video/self", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(5000);

    const url = page.url();
    const isLogin = url.includes("/login/");
    console.log("[R" + round + "] Final URL: " + url);

    // Check page elements
    const hasMore = await page.locator("label.ecom-radio-button-wrapper:has-text('更多')").first().isVisible({ timeout: 4000 }).catch(() => false);
    const hasNatural = await page.locator(":has-text('自然日')").first().isVisible({ timeout: 2000 }).catch(() => false);
    const hasDownload = await page.locator("button:has-text('下载明细')").count().catch(() => 0);
    const hasVideoDetail = await page.locator(":has-text('短视频明细')").first().isVisible({ timeout: 2000 }).catch(() => false);

    console.log("[R" + round + "] Login? " + isLogin + " | VideoDetail? " + hasVideoDetail + " | More? " + hasMore + " | Natural? " + hasNatural + " | Download:" + hasDownload);

    // Step 4: Test hover on "更多" to open dropdown
    if (hasMore) {
      console.log("[R" + round + "] Testing hover on '更多'...");
      const moreTrigger = page.locator("label.ecom-radio-button-wrapper:has-text('更多')").first();
      await moreTrigger.hover({ timeout: 2000 });
      await page.waitForTimeout(500);
      const hasDropdown = await page.locator(".ecom-dorami-date-picker-quick-picker-dropdown").first().isVisible({ timeout: 2000 }).catch(() => false);
      console.log("[R" + round + "] Dropdown appeared: " + hasDropdown);

      if (hasDropdown) {
        const naturalDay = page.locator(".ecom-dorami-date-picker-quick-picker-dropdown li:has-text('自然日')").first();
        const natVisible = await naturalDay.isVisible({ timeout: 1500 }).catch(() => false);
        console.log("[R" + round + "] Natural day option visible: " + natVisible);
      }
    }

    // Step 5: Test download button click (without actual download)
    if (hasDownload > 0) {
      console.log("[R" + round + "] Download button found, checking clickability...");
      const btn = page.locator("button:has-text('下载明细')").last();
      const btnEnabled = await btn.isEnabled().catch(() => false);
      console.log("[R" + round + "] Download btn enabled: " + btnEnabled);
    }

    return {
      round, loggedIn: !isLogin,
      hasMore, hasNatural, hasDownload, hasVideoDetail,
      url, ms: Date.now() - t0
    };

  } catch (err) {
    console.error("[R" + round + "] Error: " + err.message);
    return { round, loggedIn: false, error: err.message, ms: Date.now() - t0 };
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

  console.log("\n========== RESULTS ==========");
  console.log("Round | Login | VideoDetail | More | Natural | Download");
  results.forEach(function(r) {
    console.log("  R" + r.round + "  |  " + r.loggedIn + "  |  " + r.hasVideoDetail + "  |  " + r.hasMore + "  |  " + r.hasNatural + "  |  " + r.hasDownload + "  |  " + r.ms + "ms");
  });
})();
