const { chromium } = require("../node_modules/playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    storageState: "../storage/shop-accounts/lianou_rpa2@163.com/storageState.json",
    acceptDownloads: true
  });
  const page = await ctx.newPage();
  
  const logs = [];
  page.on("framenavigated", f => { if (f === page.mainFrame()) logs.push(f.url().slice(0, 100)); });
  page.on("console", m => { if (m.type() === "error") logs.push("ERR:" + m.text().slice(0,80)); });
  
  // Step 1: Go to fxg workspace first
  console.log("[Step1] fxg workspace...");
  await page.goto("https://fxg.jinritemai.com/ffa/mshop/homepage", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(4000);
  console.log("URL:", page.url());
  
  const hasWorkspace = await page.locator('[class*="userDropDown"], [class*="shopName"]').first().isVisible({timeout:2000}).catch(()=>false);
  const isLogin = await page.locator("text=邮箱登录, text=手机登录").first().isVisible({timeout:2000}).catch(()=>false);
  console.log("workspace已登录?", hasWorkspace, "| 登录表单?", isLogin);
  
  // Step 2: Navigate to compass video self  
  console.log("\n[Step2] compass video/self...");
  await page.goto("https://compass.jinritemai.com/shop/video/self", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(5000);
  console.log("URL:", page.url());
  
  const isLogin2 = await page.locator("text=扫码登录, text=邮箱登录").first().isVisible({timeout:2000}).catch(()=>false);
  const hasMore2 = await page.locator(":has-text('更多')").first().isVisible({timeout:2000}).catch(()=>false);
  const hasDownload = await page.locator("button:has-text('下载明细')").count().catch(()=>0);
  
  console.log("登录页?", isLogin2);
  console.log("更多按钮?", hasMore2);
  console.log("下载明细按钮:", hasDownload);
  console.log("--- 导航记录 ---");
  logs.forEach(l => console.log(l));
  
  await page.screenshot({ path: __dirname + "/shop-test.png", fullPage: false });
  console.log("截图: shop-test.png");
  
  await ctx.close();
  await browser.close();
})();
