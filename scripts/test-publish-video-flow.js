/**
 * 测试视频发布流程 — 上传视频 → 选AI封面 → 填表 → 自主声明
 */
const path = require("path");
const { chromium } = require("playwright");
const fs = require("fs");

const DEBUG_DIR = path.resolve(process.cwd(), "storage/creator-publish-debug");
const URL = "https://creator.douyin.com/creator-micro/content/post/video";

// 视频任务专用配置
const ACCOUNT = "普济堂官方旗舰店";
const VIDEO_KEY = "2913e175c3bd982febd7ca4aa2bdae46.mov";
const TITLE = "测试视频发布";
const DESC = "这是一个测试视频的描述内容";
const LINK = "https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=3745803116147245368&origin_type=604";
const PRODUCT_TITLE = "还少胶囊";
const APPROVAL_NUMBER = "不包含广审内容";
const IS_AI_CONTENT = true;

console.log("=== 视频任务配置 ===");
console.log("账号:", ACCOUNT);
console.log("视频:", VIDEO_KEY);
console.log("标题:", TITLE);
console.log("描述:", DESC);
console.log("链接:", LINK);
console.log("商品标题:", PRODUCT_TITLE);
console.log("广审批文号:", APPROVAL_NUMBER);
console.log("AI内容:", IS_AI_CONTENT);

async function report(page, tag) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try { await page.screenshot({ path: path.join(DEBUG_DIR, `video-${stamp}-${tag}.png`), fullPage: true }); } catch(e){}
  try { fs.writeFileSync(path.join(DEBUG_DIR, `video-${stamp}-${tag}.html`), await page.content(), "utf-8"); } catch(e){}
  const r = await page.evaluate(() => {
    // 封面区域 — 遍历 section 查找包含"设置封面"的
    let coverInfo = null;
    const sections = document.querySelectorAll('section');
    for (const s of sections) {
      if (s.textContent.includes('设置封面')) {
        const imgs = s.querySelectorAll('img');
        const aiStatus = s.textContent.includes('生成中') ? '生成中' : '已就绪';
        coverInfo = { status: aiStatus, imgCount: imgs.length, imgSrcs: Array.from(imgs).slice(0,3).map(i => i.src.slice(0,80)) };
        break;
      }
    }

    return {
      buttons: [...new Set(Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim().slice(0,30)).filter(Boolean))],
      inputs: Array.from(document.querySelectorAll('input:not([type="hidden"])')).filter(i => i.offsetParent !== null).map(i => ({ph:i.placeholder, v:i.value.slice(0,30)})),
      selects: [...new Set(Array.from(document.querySelectorAll('.semi-select-selection-text')).map(s => s.textContent.trim().slice(0,20)).filter(Boolean))],
      cover: coverInfo,
      modals: Array.from(document.querySelectorAll('.semi-modal-content, [class*="modal"]')).filter(el => el.offsetParent !== null).map(el => el.textContent.trim().slice(0, 300)),
    };
  });
  console.log(`\n【${tag}】`);
  console.log("  按钮:", r.buttons.join(' | '));
  console.log("  输入:", r.inputs.map(i => `${i.ph}="${i.v}"`).join(' | '));
  console.log("  选择:", r.selects.join(' | '));
  if (r.cover) console.log("  封面:", JSON.stringify(r.cover));
  const visibleModals = r.modals.filter(m => m.length > 20);
  if (visibleModals.length) console.log("  弹窗:", visibleModals[0].slice(0, 200));
  return r;
}

async function main() {
  const filePath = path.join(process.cwd(), "storage/creator-materials", VIDEO_KEY);
  if (!fs.existsSync(filePath)) { console.error(`❌ 视频不存在: ${filePath}`); process.exit(1); }
  console.log("✓ 视频文件存在");

  const ssp = path.join(process.cwd(), "storage/creator-accounts", ACCOUNT, "storageState.json");
  if (!fs.existsSync(ssp)) { console.error(`❌ 账号 ${ACCOUNT} 无登录态`); process.exit(1); }
  console.log("✓ 登录态");
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: ssp, locale: "zh-CN" });
  const page = await ctx.newPage();

  try {
    // 1. 导航
    console.log("\n=== 1. 导航到视频发布页 ===");
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    // 等待 SPA 渲染完成：标题输入框必须可见
    await page.waitForSelector('input[placeholder*="标题"]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    if (await page.locator('text=登录').first().isVisible().catch(() => false)) {
      console.log("⚠️ 需要登录"); await page.waitForTimeout(30000);
    }
    await report(page, "01-loaded");

    // 2. 上传视频 — 视频页面不触发原生 filechooser，直接 setInputFiles
    console.log("\n=== 2. 上传视频 ===");
    // file input 是隐藏的，用 attached 而非 visible
    await page.waitForSelector('input[type="file"][accept*="video"]', { state: 'attached', timeout: 30000 }).catch(() => {});
    const videoInput = page.locator('input[type="file"][accept*="video"]').first();
    if (await videoInput.count() > 0) {
      await videoInput.setInputFiles(filePath);
      console.log("  ✓ 已选择视频文件，等待上传处理...");
    } else {
      console.log("  ❌ 找不到视频上传入口");
    }

    // 等待视频上传完成
    console.log("  等待上传完成...");
    try {
      await page.waitForFunction(() => {
        const video = document.querySelector('video');
        const blobImg = document.querySelector('img[src^="blob:"]');
        return video || blobImg;
      }, { timeout: 120000 });
    } catch {}
    await page.waitForTimeout(2000);
    await report(page, "02-after-upload");

    // 3. 选择封面：第一帧默认可直接用，同时尝试选AI封面
    console.log("\n=== 3. 选择封面 ===");
    // 等待AI封面容器出现（视频上传后AI封面异步生成）
    const aiContainer = await page.waitForSelector('[class*="recommendCoverContainer"]', { timeout: 30000 }).catch(() => null);

    if (aiContainer) {
      await page.waitForTimeout(3000);
      // 找AI封面项（跳过生成中的占位符）
      const aiCoverItems = page.locator('[class*="recommendCoverContainer"] > [class*="recommendCover"]');
      const aiCount = await aiCoverItems.count().catch(() => 0);
      console.log(`  AI推荐封面数: ${aiCount}`);

      if (aiCount > 0) {
        for (let i = 0; i < aiCount; i++) {
          const item = aiCoverItems.nth(i);
          if (!(await item.isVisible().catch(() => false))) continue;
          const classAttr = await item.getAttribute("class").catch(() => "");
          if (/isSetting/i.test(classAttr)) continue;
          const imgs = await item.locator("img").count().catch(() => 0);
          if (imgs === 0) continue;

          // 用 dispatchEvent 点击避免被弹窗拦截
          await item.evaluate(el => el.click());
          await page.waitForTimeout(1000);
          console.log(`  ✓ 已点击第 ${i + 1} 个AI推荐封面`);
          break;
        }
      } else {
        console.log("  AI封面仍在生成中，使用默认第一帧");
      }
    } else {
      console.log("  AI封面容器未出现，使用默认第一帧封面");
    }

    // 关闭可能打开的封面编辑器弹窗
    const modalConfirm = page.locator('.semi-modal-content button:has-text("确定"), .semi-modal-wrap button:has-text("确定")').first();
    if (await modalConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      await modalConfirm.click();
      await page.waitForTimeout(1000);
      console.log("  ✓ 已关闭封面编辑弹窗");
    } else {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
    }
    await report(page, "03-cover-selected");

    // 4. 标题+描述
    console.log("\n=== 4. 标题+描述 ===");
    const titleInput = page.locator('input[placeholder*="标题"]').first();
    if (await titleInput.isVisible().catch(() => false)) {
      await titleInput.click();
      await titleInput.fill(TITLE);
    }
    const descInput = page.locator('[data-placeholder*="描述"], [contenteditable="true"]').first();
    if (await descInput.isVisible().catch(() => false)) {
      await descInput.click();
      await descInput.fill(DESC);
    }
    console.log("  ✓ 已填写");
    await report(page, "04-form-filled");

    // 5. 购物车+链接（视频页：点击"位置/购物车"下拉框切换）
    console.log("\n=== 5. 购物车+链接 ===");
    // 视频页的购物车入口在"添加标签"区域下的 select-lJTtRL 下拉框
    const tagSelect = page.locator('.select-lJTtRL, .anchor-container-hgj7gj .semi-select').first();
    if (await tagSelect.isVisible().catch(() => false)) {
      await tagSelect.click();
      await page.waitForTimeout(1500);
      console.log("  已打开下拉菜单");

      // 找"购物车"选项
      const cartOpt = page.locator('[role="option"]:has-text("购物车")').first();
      if (await cartOpt.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cartOpt.click();
        await page.waitForTimeout(2000);
        console.log("  ✓ 已选择购物车");

        // 填写商品链接
        const linkInput = page.locator('#douyin_creator_pc_anchor_jump input, input[placeholder*="粘贴商品"], input[placeholder*="链接"]').first();
        if (await linkInput.isVisible().catch(() => false)) {
          await linkInput.fill(LINK);
          console.log("  ✓ 链接已填入");
          // 等页面处理链接（可能自动弹出编辑弹窗，或出现"添加链接"按钮）
          await page.waitForTimeout(3000);
        }

        // 先检查是否已自动弹出编辑弹窗
        let editModal = page.locator('.semi-modal-content').filter({ hasText: '完成编辑' }).first();
        if (await editModal.isVisible().catch(() => false)) {
          console.log("  ✓ 商品编辑弹窗已自动打开");
        } else {
          // 点击"添加链接"触发编辑弹窗
          const addLinkBtn = page.locator('span:has-text("添加链接"), button:has-text("添加链接")').first();
          if (await addLinkBtn.isVisible().catch(() => false)) {
            await addLinkBtn.click();
            await page.waitForTimeout(4000);
            console.log("  ✓ 已点击添加链接");
          }
        }

        // 再次检测编辑弹窗
        editModal = page.locator('.semi-modal-content').filter({ hasText: '完成编辑' }).first();
        if (await editModal.isVisible().catch(() => false)) {
          // 检测限额弹窗
          const limitModal = page.locator('.semi-modal-content').filter({ hasText: '无法添加购物车' }).first();
          if (await limitModal.isVisible().catch(() => false)) {
            throw new Error("购物车限额");
          }

          console.log("  ✓ 商品编辑弹窗已打开");
          const ptInput = page.locator('input[placeholder="请输入商品短标题"]').first();
          if (await ptInput.isVisible().catch(() => false)) {
            await ptInput.fill(PRODUCT_TITLE);
          }
          const apInput = page.locator('input[placeholder*="广审"]').first();
          if (await apInput.isVisible().catch(() => false)) {
            await apInput.fill(APPROVAL_NUMBER);
          }
          const finishBtn = editModal.locator('button:has-text("完成编辑")').first();
          if (await finishBtn.isVisible().catch(() => false)) {
            await finishBtn.click();
            await page.waitForTimeout(3000);
            console.log("  ✓ 已点击完成编辑");
          }
        }
      } else {
        await page.keyboard.press("Escape");
        console.log("  ⚠️ 下拉菜单中未找到购物车选项");
      }
    } else {
      console.log("  ⚠️ 未找到添加标签下拉框，跳过购物车");
    }
    await report(page, "05-cart");

    // 6. 自主声明
    console.log("\n=== 6. 自主声明 ===");
    const targetLabel = IS_AI_CONTENT ? "内容由AI生成" : "无需添加自主声明";
    const declarationSection = page.locator('section:has(.title-cnbkZe:has-text("自主声明"))').first();
    const selectBox = declarationSection.locator('[class*="selectBox"]').first();
    if (await selectBox.isVisible().catch(() => false)) {
      const curText = await selectBox.locator('[class*="selectText"]').first().textContent().catch(() => "");
      console.log(`  当前: ${curText.trim()}`);
      if (!curText.includes(targetLabel)) {
        await selectBox.click();
        await page.waitForTimeout(1500);
        const targetOption = page.locator(`label:has-text("${targetLabel}")`).first();
        if (await targetOption.isVisible().catch(() => false)) {
          await targetOption.click();
          await page.waitForTimeout(500);
          console.log(`  ✓ 已选择: ${targetLabel}`);
        }
        const confirmBtn = page.locator('.semi-modal-content button:has-text("确定")').first();
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(1000);
          console.log("  ✓ 已确定");
        }
      } else {
        console.log("  ✓ 已是目标选项");
      }
    }
    await report(page, "06-self-declaration");

    // 7. 最终状态
    await report(page, "07-final");
    console.log("\n✅ 视频发布准备完成，停留5s确认。");
    await page.waitForTimeout(5000);
    console.log("✅ 测试完成");
  } catch(e) {
    console.error("❌", e.message);
    await report(page, "error").catch(() => {});
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
main().catch(console.error);
