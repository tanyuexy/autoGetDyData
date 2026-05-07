async (page) => {
  const fs = require('fs');
  const cookies = JSON.parse(fs.readFileSync('/Users/xy/code/tool/autoGetDyData/.playwright-mcp/shop-cookies.json', 'utf-8'));
  const context = page.context();
  await context.addCookies(cookies);
  
  await page.goto('https://compass.jinritemai.com/shop/video/self', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
  
  const hasVideoDetail = await page.locator('text=短视频明细').first().isVisible({ timeout: 5000 }).catch(() => false);
  const hasMore = await page.locator('label.ecom-radio-button-wrapper:has-text("更多")').first().isVisible({ timeout: 5000 }).catch(() => false);
  const downloadBtns = await page.locator('button:has-text("下载明细")').count().catch(() => 0);
  
  // Check for login form
  const hasLogin = await page.locator('text=邮箱登录, text=手机登录').first().isVisible({ timeout: 2000 }).catch(() => false);
  
  return { 
    url: page.url(), 
    title: await page.title(),
    hasVideoDetail, 
    hasMore, 
    downloadBtnCount: downloadBtns,
    hasLogin,
    isLoggedIn: hasVideoDetail && !hasLogin
  };
}