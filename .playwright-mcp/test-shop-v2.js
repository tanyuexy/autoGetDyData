const { chromium } = require("/Users/xy/code/tool/autoGetDyData/node_modules/playwright");
const LOGIN_URL = "https://fxg.jinritemai.com/login/common";
const EMAIL = "lianou_rpa@163.com";
const PASSWORD = "Lianou123";
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
    
    // Step 1: Navigate
    console.log("[R" + round + "] Navigating to login page...");
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2000);
    
    let url = page.url();
    if (url.includes("/ffa/mshop") || url.includes("/compass")) {
      console.log("[R" + round + "] Already authenticated! URL: " + url);
    } else if (url.includes("/login/")) {
      console.log("[R" + round + "] On login page, switching to email tab...");
      
      const emailTab = page.locator(':text-is("邮箱登录")').first();
      const tabVisible = await emailTab.isVisible({ timeout: 2000 }).catch(() => false);
      console.log("[R" + round + "] Email tab visible: " + tabVisible);
      
      if (tabVisible) {
        await emailTab.click({ timeout: 2000 });
        await page.waitForTimeout(800);
        
        const pwLoc = page.locator('input[type="password"]').first();
        await pwLoc.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
        
        console.log("[R" + round + "] Filling credentials...");
        const emailInput = page.locator('input[placeholder="请输入邮箱"], input[placeholder*="邮箱"], input[type="email"]').first();
        await emailInput.click({ clickCount: 3 }).catch(() => {});
        await emailInput.fill("").catch(() => {});
        await emailInput.fill(EMAIL);
        
        const pwInput = page.locator('input[type="password"], input[placeholder="密码"]').first();
        await pwInput.click({ clickCount: 3 }).catch(() => {});
        await pwInput.fill("").catch(() => {});
        await pwInput.fill(PASSWORD);
        
        const cb = page.locator('input[type="checkbox"]').first();
        const checked = await cb.isChecked().catch(() => false);
        if (!checked) {
          await cb.click({ timeout: 2000 }).catch(function() { return cb.click({ force: true, timeout: 2000 }); });
        }
        await page.waitForTimeout(300);
        
        console.log("[R" + round + "] Clicking login button...");
        try {
          const btn = page.locator('button:not([disabled])', { hasText: "登录" }).first();
          await btn.waitFor({ state: "visible", timeout: 8000 });
          await btn.click({ timeout: 3000, noWaitAfter: true });
          console.log("[R" + round + "] Login button clicked!");
        } catch (e) {
          console.log("[R" + round + "] Login click error, force retry: " + e.message.slice(0, 60));
          try {
            await page.locator('button', { hasText: "登录" }).first().click({ force: true, noWaitAfter: true });
          } catch (e2) {}
        }
        
        console.log("[R" + round + "] Waiting for redirect...");
        for (let i = 0; i < 30; i++) {
          await page.waitForTimeout(1000);
          url = page.url();
          if (!url.includes("/login/")) break;
          if (i % 5 === 4) console.log("[R" + round + "] Still waiting (" + (i+1) + "s)...");
        }
        console.log("[R" + round + "] URL after login: " + url);
      }
    }
    
    // Step 2: Navigate to compass
    url = page.url();
    const isOnLogin = url.includes("/login/");
    if (!isOnLogin) {
      console.log("[R" + round + "] Going to compass video/self...");
      await page.goto("https://compass.jinritemai.com/shop/video/self", { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(5000);
      url = page.url();
      console.log("[R" + round + "] Final URL: " + url);
      
      const isLogin = url.includes("/login/");
      const hasMore = await page.locator("label.ecom-radio-button-wrapper:has-text('更多')").first().isVisible({timeout:3000}).catch(()=>false);
      const hasNatural = await page.locator(":has-text('自然日')").first().isVisible({timeout:2000}).catch(()=>false);
      const hasDownload = await page.locator("button:has-text('下载明细')").count().catch(()=>0);
      
      console.log("[R" + round + "] Login? " + isLogin + " | More? " + hasMore + " | Natural? " + hasNatural + " | Download:" + hasDownload);
      
      return { round: round, loggedIn: !isLogin, hasMore: hasMore, hasNatural: hasNatural, hasDownload: hasDownload, url: url, ms: Date.now()-t0 };
    } else {
      console.log("[R" + round + "] Still on login page: " + url);
      return { round: round, loggedIn: false, url: url, ms: Date.now()-t0 };
    }
  } catch (err) {
    console.error("[R" + round + "] Error: " + err.message);
    return { round: round, loggedIn: false, error: err.message, ms: Date.now()-t0 };
  } finally {
    await ctx.close();
    await browser.close();
  }
}

(async () => {
  const results = [];
  for (let r = 1; r <= 3; r++) {
    results.push(await runTest(r));
    console.log(JSON.stringify(results[results.length-1]));
  }
  console.log("\n========== RESULTS ==========");
  results.forEach(function(r) {
    console.log("R" + r.round + ": login=" + r.loggedIn + " more=" + r.hasMore + " natural=" + r.hasNatural + " dl=" + r.hasDownload + " " + r.ms + "ms");
  });
})();
