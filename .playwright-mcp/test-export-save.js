const { chromium } = require("/Users/xy/code/tool/autoGetDyData/node_modules/playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const OUT = "/Users/xy/code/tool/autoGetDyData/.playwright-mcp/exports";
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    acceptDownloads: true,
    storageState: "/Users/xy/code/tool/autoGetDyData/storage/shop-accounts/lianou_rpa@163.com/storageState.json"
  });
  const page = await ctx.newPage();

  // Step 1: Pick shop
  console.log("[Step1] 选店...");
  await page.goto("https://fxg.jinritemai.com/login/common", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.locator("[class*=roleItem]").first().click({ timeout: 5000 });
  await page.waitForTimeout(5000);

  // Step 2: Go to compass
  console.log("[Step2] 罗盘短视频...");
  await page.goto("https://compass.jinritemai.com/shop/video/self", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("text=自营视频").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4000);

  // Step 3: Select date
  console.log("[Step3] 选日期...");
  await page.locator("label").filter({ hasText: "更多" }).first().click({ timeout: 2000 });
  await page.waitForTimeout(600);
  const dd = page.locator(".ecom-dorami-date-picker-quick-picker-dropdown").first();
  await dd.locator("li").filter({ hasText: "自然日" }).first().click({ timeout: 2000 });
  await page.waitForTimeout(1000);

  const scope = dd.locator(".ecom-dorami-date-picker-right-container, .ecom-picker-panel-container").first();
  const cells = scope.locator("td.ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner");
  const count = await cells.count().catch(() => 0);
  console.log("  可选日期: " + count + "天");

  if (count > 0) {
    const lastCell = cells.nth(count - 1);
    const day = await lastCell.innerText().catch(() => "");
    console.log("  点击日期: " + day);
    await lastCell.click({ timeout: 2000 });
  }
  await page.waitForTimeout(800);

  // Step 4: Download
  console.log("[Step4] 导出下载...");
  const btn = page.locator("button").filter({ hasText: "下载明细" }).first();
  if (await btn.isEnabled().catch(() => false)) {
    const dlPromise = page.waitForEvent("download", { timeout: 30000 });
    await btn.click({ timeout: 3000 });
    const dl = await dlPromise;
    const fname = dl.suggestedFilename();
    console.log("  文件名: " + fname);

    const savePath = path.join(OUT, fname);
    await dl.saveAs(savePath);

    const stat = fs.statSync(savePath);
    console.log("  路径: " + savePath);
    console.log("  大小: " + (stat.size / 1024).toFixed(1) + " KB");
    console.log("  结果: " + (stat.size > 500 ? "✅ 有效文件" : "⚠️ 文件过小"));
  } else {
    console.log("  ❌ 按钮不可用");
  }

  await ctx.close();
  await browser.close();
  console.log("完成");
})();
