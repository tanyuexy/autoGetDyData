const { chromium } = require("/Users/xy/code/tool/autoGetDyData/node_modules/playwright");
const fs = require("fs");
const path = require("path");

async function runExport(round, roleItemIdx) {
  const OUT = "/Users/xy/code/tool/autoGetDyData/.playwright-mcp/exports";
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    acceptDownloads: true,
    storageState: "/Users/xy/code/tool/autoGetDyData/storage/shop-accounts/lianou_rpa@163.com/storageState.json"
  });
  const page = await ctx.newPage();
  const t0 = Date.now();

  try {
    // Pick shop
    await page.goto("https://fxg.jinritemai.com/login/common", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);
    const items = page.locator("[class*=roleItem]");
    const total = await items.count().catch(() => 0);
    const idx = Math.min(roleItemIdx, total - 1);
    const name = await items.nth(idx).locator("[class*=introName]").first().textContent({ timeout: 2000 }).catch(() => "unknown");
    await items.nth(idx).click({ timeout: 5000 });
    await page.waitForTimeout(5000);

    // Go to compass
    await page.goto("https://compass.jinritemai.com/shop/video/self", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.locator("text=自营视频").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(4000);

    // Select date
    await page.locator("label").filter({ hasText: "更多" }).first().click({ timeout: 2000 });
    await page.waitForTimeout(600);
    const dd = page.locator(".ecom-dorami-date-picker-quick-picker-dropdown").first();
    await dd.locator("li").filter({ hasText: "自然日" }).first().click({ timeout: 2000 });
    await page.waitForTimeout(1000);

    const scope = dd.locator(".ecom-dorami-date-picker-right-container, .ecom-picker-panel-container").first();
    const cells = scope.locator("td.ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner");
    const cellCount = await cells.count().catch(() => 0);
    if (cellCount > 0) {
      await cells.nth(cellCount - 1).click({ timeout: 2000 });
    }
    await page.waitForTimeout(800);

    // Download
    const btn = page.locator("button").filter({ hasText: "下载明细" }).first();
    if (!(await btn.isEnabled().catch(() => false))) {
      return { round, shop: name, ok: false, reason: "btn disabled", ms: Date.now() - t0 };
    }

    const dlPromise = page.waitForEvent("download", { timeout: 30000 });
    await btn.click({ timeout: 3000 });
    const dl = await dlPromise;
    const fname = "R" + round + "_" + dl.suggestedFilename();
    const savePath = path.join(OUT, fname);
    await dl.saveAs(savePath);
    const stat = fs.statSync(savePath);

    return {
      round, shop: name, ok: true,
      filename: fname,
      size: (stat.size / 1024).toFixed(1) + " KB",
      ms: Date.now() - t0
    };
  } catch (e) {
    return { round, ok: false, error: e.message.slice(0, 80), ms: Date.now() - t0 };
  } finally {
    await ctx.close();
    await browser.close();
  }
}

(async () => {
  const results = [];
  // R1: shop index 0
  results.push(await runExport(1, 0));
  console.log("R1:", JSON.stringify(results[0]));
  // R2: shop index 2 (different shop)
  results.push(await runExport(2, 2));
  console.log("R2:", JSON.stringify(results[1]));
  // R3: shop index 0 again
  results.push(await runExport(3, 0));
  console.log("R3:", JSON.stringify(results[2]));

  console.log("\n========== 3轮导出结果 ==========");
  results.forEach(r => {
    if (r.ok) {
      console.log("✅ R" + r.round + " | " + r.shop + " | " + r.filename + " | " + r.size + " | " + r.ms + "ms");
    } else {
      console.log("❌ R" + r.round + " | " + (r.shop || "?") + " | " + (r.reason || r.error) + " | " + r.ms + "ms");
    }
  });
})();
