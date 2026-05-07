const { chromium } = require("/Users/xy/code/tool/autoGetDyData/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    acceptDownloads: true,
    storageState: "/Users/xy/code/tool/autoGetDyData/storage/shop-accounts/lianou_rpa@163.com/storageState.json"
  });
  const page = await ctx.newPage();

  // Pick shop
  await page.goto("https://fxg.jinritemai.com/login/common", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.locator("[class*=roleItem]").first().click({ timeout: 5000 });
  await page.waitForTimeout(5000);

  // Go to compass
  await page.goto("https://compass.jinritemai.com/shop/video/self", { waitUntil: "domcontentloaded", timeout: 20000 });
  try { await page.locator("text=自营视频").first().waitFor({ state: "visible", timeout: 15000 }); } catch(e) {}
  await page.waitForTimeout(4000);

  // Open dropdown + natural day
  await page.locator("label").filter({ hasText: "更多" }).first().click({ timeout: 2000 });
  await page.waitForTimeout(600);
  const dd = page.locator(".ecom-dorami-date-picker-quick-picker-dropdown").first();
  await dd.locator("li").filter({ hasText: "自然日" }).first().click({ timeout: 2000 });
  await page.waitForTimeout(1000);

  console.log("=== Calendar Header Structure ===\n");

  // Dump the full structure above the calendar table
  const pickerBody = dd.locator(".ecom-picker-body").first();
  
  // Get the parent panel that contains both header and body
  const parent = pickerBody.locator("..").first();
  const parentTag = await parent.evaluate(el => el.tagName).catch(() => "?");
  const parentClass = (await parent.getAttribute("class").catch(() => "")) || "";
  console.log("Picker body parent: <" + parentTag + "> class=" + parentClass.slice(0, 100));

  // Check parent's siblings (sibling panels = month panels)
  const grandParent = parent.locator("..").first();
  const grandTag = await grandParent.evaluate(el => el.tagName).catch(() => "?");
  const grandClass = (await grandParent.getAttribute("class").catch(() => "")) || "";
  console.log("Grandparent: <" + grandTag + "> class=" + grandClass.slice(0, 100));

  // All elements with "panel" in class
  const panels = dd.locator("[class*=panel]");
  const panelCount = await panels.count().catch(() => 0);
  console.log("\n[class*=panel] elements:", panelCount);
  for (let i = 0; i < panelCount; i++) {
    const tag = await panels.nth(i).evaluate(el => el.tagName).catch(() => "?");
    const cls = (await panels.nth(i).getAttribute("class").catch(() => "")) || "";
    console.log("  [" + i + "] <" + tag + "> " + cls.slice(0, 120));
  }

  // Look for buttons in the dropdown (prev/next month)
  console.log("\n=== All buttons in dropdown ===");
  const allBtns = dd.locator("button, [role=button], [class*=btn]");
  const btnCount = await allBtns.count().catch(() => 0);
  console.log("Buttons/btn-like:", btnCount);
  for (let i = 0; i < Math.min(btnCount, 10); i++) {
    const text = (await allBtns.nth(i).innerText().catch(() => "")).trim();
    const cls = (await allBtns.nth(i).getAttribute("class").catch(() => "")) || "";
    const tag = await allBtns.nth(i).evaluate(el => el.tagName).catch(() => "?");
    console.log("  [" + i + "] <" + tag + "> class=" + cls.slice(0, 80) + " text='" + text + "'");
  }

  // Look for header elements with month/year
  console.log("\n=== Month/Year elements ===");
  const headers = dd.locator("[class*=header]");
  const hCount = await headers.count().catch(() => 0);
  console.log("[class*=header]:", hCount);
  for (let i = 0; i < hCount; i++) {
    const text = (await headers.nth(i).innerText().catch(() => "")).trim();
    const cls = (await headers.nth(i).getAttribute("class").catch(() => "")) || "";
    console.log("  [" + i + "] text='" + text + "' class=" + cls.slice(0, 100));
  }

  // Look for the sup-prev-btn (double arrow left) at top level
  console.log("\n=== Sup/Super prev buttons ===");
  const supBtns = dd.locator("[class*=prev], [class*=Prev], [class*=left]");
  const supCount = await supBtns.count().catch(() => 0);
  console.log("[class*=prev/left]:", supCount);
  for (let i = 0; i < Math.min(supCount, 10); i++) {
    const text = (await supBtns.nth(i).innerText().catch(() => "")).trim();
    const cls = (await supBtns.nth(i).getAttribute("class").catch(() => "")) || "";
    console.log("  [" + i + "] text='" + text + "' class=" + cls.slice(0, 100));
  }

  // Directly try: the date picker panel wrapper at top level
  const wrapper = dd.locator(".ecom-dorami-date-picker-panel-with-border").first();
  const wrapperVisible = await wrapper.isVisible({ timeout: 500 }).catch(() => false);
  console.log("\nPanel wrapper visible:", wrapperVisible);
  if (wrapperVisible) {
    const wChildren = wrapper.locator("> *");
    const wCount = await wChildren.count().catch(() => 0);
    console.log("Wrapper children:", wCount);
    for (let i = 0; i < wCount; i++) {
      const tag = await wChildren.nth(i).evaluate(el => el.tagName).catch(() => "?");
      const cls = (await wChildren.nth(i).getAttribute("class").catch(() => "")) || "";
      const text = (await wChildren.nth(i).innerText().catch(() => "")).slice(0, 80).replace(/\n/g, " ");
      console.log("  [" + i + "] <" + tag + "> class=" + cls.slice(0, 80));
      console.log("       text=" + text);
    }
  }

  await page.screenshot({ path: "/Users/xy/code/tool/autoGetDyData/.playwright-mcp/cal-header.png" });

  await ctx.close();
  await browser.close();
})();
