/**
 * 测试 tasks.json 配置的真实发布流程
 * 使用真实抖音小店链接，停在商品编辑弹窗
 */
const path = require("path");
const { chromium } = require("playwright");
const fs = require("fs");

const DEBUG_DIR = path.resolve(process.cwd(), "storage/creator-publish-debug");
const URL = "https://creator.douyin.com/creator-micro/content/post/image?default-tab=3&enter_from=publish_page&media_type=image&type=new";

const tasks = JSON.parse(fs.readFileSync(path.join(process.cwd(), "storage/creator-publish/tasks.json"), "utf-8"));
const task = tasks[0];
const ACCOUNT = task.accountName;
const IMAGE_KEYS = task.payload.imagesFileKeys;
const TITLE = task.payload.title;
const DESC = task.payload.description;
const LINK = task.payload.productLink;

console.log("=== 任务配置 ===");
console.log("账号:", ACCOUNT);
console.log("图片:", IMAGE_KEYS.join(", "));
console.log("标题:", TITLE);
console.log("描述:", DESC);
console.log("链接:", LINK);

async function report(page, tag) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try { await page.screenshot({ path: path.join(DEBUG_DIR, `${stamp}-${tag}.png`), fullPage: true }); } catch(e){}
  try { fs.writeFileSync(path.join(DEBUG_DIR, `${stamp}-${tag}.html`), await page.content(), "utf-8"); } catch(e){}
  const r = await page.evaluate(() => ({
    buttons: [...new Set(Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim().slice(0,30)).filter(Boolean))],
    inputs: Array.from(document.querySelectorAll('input:not([type="hidden"])')).filter(i => i.offsetParent !== null).map(i => ({ph:i.placeholder, v:i.value.slice(0,30)})),
    selects: [...new Set(Array.from(document.querySelectorAll('.semi-select-selection-text')).map(s => s.textContent.trim().slice(0,20)).filter(Boolean))],
    modals: Array.from(document.querySelectorAll('.semi-modal-content, [class*="modal"]')).filter(el => el.offsetParent !== null).map(el => el.textContent.trim().slice(0, 300)),
  }));
  console.log(`\n【${tag}】`);
  console.log("  按钮:", r.buttons.join(' | '));
  console.log("  输入:", r.inputs.map(i => `${i.ph}="${i.v}"`).join(' | '));
  console.log("  选择:", r.selects.join(' | '));
  const visibleModals = r.modals.filter(m => m.length > 20);
  if (visibleModals.length) console.log("  弹窗:", visibleModals[0].slice(0, 200));
  return r;
}

async function main() {
  const filePaths = IMAGE_KEYS.map(k => path.join(process.cwd(), "storage/creator-materials", k));
  for (const fp of filePaths) { if (!fs.existsSync(fp)) { console.error(`❌ 图片不存在: ${fp}`); process.exit(1); } }
  console.log("✓ 图片文件存在");
  const ssp = path.join(process.cwd(), "storage/creator-accounts", ACCOUNT, "storageState.json");
  if (!fs.existsSync(ssp)) { console.error(`❌ 账号 ${ACCOUNT} 无登录态`); process.exit(1); }
  console.log("✓ 登录态");
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: ssp, locale: "zh-CN" });
  const page = await ctx.newPage();

  try {
    // 1. 导航
    console.log("\n=== 1. 导航 ===");
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    if (await page.locator('text=登录').first().isVisible().catch(() => false)) {
      console.log("⚠️ 需要登录"); await page.waitForTimeout(30000);
    }
    await report(page, "01-loaded");

    // 2. 上传
    console.log("\n=== 2. 上传图片 ===");
    const fcP = page.waitForEvent('filechooser', { timeout: 20000 }).catch(() => null);
    await page.getByText("点击上传").first().click().catch(() => page.locator('div:has-text("点击上传")').last().click());
    await page.waitForTimeout(3000);
    const fc = await fcP;
    if (fc) { await fc.setFiles(filePaths); await page.waitForTimeout(8000); }
    await report(page, "02-after-upload");

    // 3. 标题+描述
    console.log("\n=== 3. 标题+描述 ===");
    await page.locator('input[placeholder*="标题"]').first().fill(TITLE);
    await page.locator('[data-placeholder*="描述"]').first().fill(DESC);
    await report(page, "03-form-filled");

    // 4. 购物车
    console.log("\n=== 4. 购物车 ===");
    const anchor = page.locator('#douyin_creator_pc_anchor_jump');
    await anchor.locator('.semi-select').first().click();
    await page.waitForTimeout(1500);
    const cartOpt = page.locator('[role="option"]').filter({ hasText: '购物车' }).first();
    if (await cartOpt.isVisible().catch(() => false)) {
      await cartOpt.click();
      await page.waitForTimeout(2000);
      console.log("  ✓ 购物车");
    } else {
      await page.keyboard.press('Escape');
      console.log("  ⚠️ 无购物车选项");
    }
    await report(page, "04a-cart-selected");

    // 5. 填链接
    console.log("\n=== 5. 填写链接 ===");
    await anchor.locator('input').first().fill(LINK);
    console.log("  ✓ 链接已填入");

    // 6. 添加链接 → 停在弹窗
    console.log("\n=== 6. 添加链接 ===");
    const addSpan = anchor.locator('span:has-text("添加链接")').first();
    if (await addSpan.isVisible().catch(() => false)) {
      await addSpan.click();
      await page.waitForTimeout(4000);

      // 检查弹窗
      const modalContent = await page.evaluate(() => {
        const modals = document.querySelectorAll('.semi-modal-content');
        const found = [];
        modals.forEach(m => {
          if (m.offsetParent !== null) {
            found.push({
              text: m.textContent.trim().slice(0, 500),
              inputs: Array.from(m.querySelectorAll('input')).map(i => ({ ph: i.placeholder, v: i.value })),
              buttons: Array.from(m.querySelectorAll('button, [class*="btn"]')).map(b => b.textContent.trim().slice(0, 20)).filter(Boolean),
            });
          }
        });
        return found;
      });

      if (modalContent.length > 0) {
        console.log("\n⚠️ 商品编辑弹窗已打开，停留在该页面：");
        console.log("  ┌─ 弹窗内容 ──────────────────────────");
        console.log(`  │ ${modalContent[0].text.slice(0, 200)}`);
        console.log("  │");
        if (modalContent[0].inputs.length) {
          modalContent[0].inputs.forEach(inp => console.log(`  │ 输入框: "${inp.ph}"`));
        }
        if (modalContent[0].buttons.length) {
          console.log(`  │ 按钮: ${modalContent[0].buttons.join(' | ')}`);
        }
        console.log("  └────────────────────────────────────");
        console.log("  弹窗已保留在页面，供你查看处理。");
        await report(page, "04c-modal-open");
      } else {
        console.log("  → 无弹窗，链接可能已直接添加");
      }
    }

    await report(page, "05-final");
    console.log("\n✅ 浏览器保持打开 (600s)。");
    await page.waitForTimeout(600000);
  } catch(e) {
    console.error("❌", e.message);
    await report(page, "error").catch(() => {});
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
main().catch(console.error);
