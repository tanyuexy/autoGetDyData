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
const IS_AI_CONTENT = task.payload.isAiContent === true;

console.log("=== 任务配置 ===");
console.log("账号:", ACCOUNT);
console.log("图片:", IMAGE_KEYS.join(", "));
console.log("标题:", TITLE);
console.log("描述:", DESC);
console.log("链接:", LINK);
console.log("AI内容:", IS_AI_CONTENT);

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
        console.log("\n⚠️ 商品编辑弹窗已打开，尝试自动填写...");
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

        // 自动填写商品短标题
        const productTitleInput = page.locator('input[placeholder="请输入商品短标题"]').first();
        if (await productTitleInput.isVisible().catch(() => false)) {
          await productTitleInput.fill("还少胶囊");
          console.log("  ✓ 已填写商品短标题");
        } else {
          console.log("  ⚠️ 未找到商品短标题输入框");
        }

        // 自动填写广审批文号
        const approvalInput = page.locator('input[placeholder*="广审"]').first();
        if (await approvalInput.isVisible().catch(() => false)) {
          await approvalInput.fill("不包含广审内容");
          console.log("  ✓ 已填写广审批文号");
        } else {
          console.log("  ⚠️ 未找到广审批文号输入框");
        }

        await report(page, "04c-modal-filled");

        // 点击完成编辑
        const finishBtn = page.locator('.semi-modal-content button:has-text("完成编辑")').first();
        if (await finishBtn.isVisible().catch(() => false)) {
          await finishBtn.click();
          await page.waitForTimeout(3000);
          console.log("  ✓ 已点击完成编辑");
          await report(page, "04d-after-finish");
        } else {
          console.log("  ⚠️ 未找到完成编辑按钮，停留在弹窗供查看");
          await report(page, "04c-modal-open");
          console.log("  弹窗已保留在页面，供你查看处理。");
          await page.waitForTimeout(600000);
          return;
        }
      } else {
        console.log("  → 无弹窗，链接可能已直接添加");
      }
    }

    await report(page, "05-final");

    // 6.5 自主声明
    console.log("\n=== 6.5 自主声明 ===");
    const targetLabel = IS_AI_CONTENT ? "内容由AI生成" : "无需添加自主声明";
    const declarationSection = page.locator('section:has(.title-cnbkZe:has-text("自主声明"))').first();
    const selectBox = declarationSection.locator('[class*="selectBox"]').first();
    if (await selectBox.isVisible().catch(() => false)) {
      const curText = await selectBox.locator('[class*="selectText"]').first().textContent().catch(() => "");
      console.log(`  当前自主声明: ${curText.trim()}`);
      if (curText.includes(targetLabel)) {
        console.log(`  ✓ 已是: ${targetLabel}`);
      } else {
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
          console.log("  ✓ 已确定关闭自主声明弹窗");
        }
      }
    } else {
      console.log("  ⚠️ 未找到自主声明下拉框");
    }
    await report(page, "05b-self-declaration");

    // 7. 选择音乐
    console.log("\n=== 7. 选择音乐 ===");
    const musicAction = page.locator('span:has-text("选择音乐")').last();
    if (await musicAction.isVisible().catch(() => false)) {
      await musicAction.click();
      await page.waitForTimeout(3000);
      console.log("  ✓ 已点击选择音乐");

      await report(page, "06-music-panel");

      // 点击"热门榜"标签
      const hotTab = page.locator('div[role="tab"]:has-text("热门榜")').first();
      if (await hotTab.isVisible().catch(() => false)) {
        await hotTab.click();
        await page.waitForTimeout(3000);
        console.log("  ✓ 已点击热门榜");

        // 查找所有热门榜歌曲
        const songNames = page.locator('.semi-tabs-pane-active .song-name-oRge4d');
        const songCount = await songNames.count().catch(() => 0);
        console.log(`\n  找到 ${songCount} 首热门歌曲`);

        if (songCount > 0) {
          const randomIdx = Math.floor(Math.random() * songCount);
          const selectedName = await songNames.nth(randomIdx).textContent();
          console.log(`  随机选择: [${randomIdx}] ${selectedName}`);

          // hover 卡片触发 "使用" 按钮（先定位到 card-wrapper）
          const targetCard = songNames.nth(randomIdx).locator('xpath=./ancestor::div[contains(@class, "card-wrapper")]');
          await targetCard.hover().catch(() => {});
          await page.waitForTimeout(1500);

          // 点击 "使用" 按钮
          const useBtn = targetCard.locator('button:has-text("使用")').first();
          if (await useBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await useBtn.click();
            await page.waitForTimeout(2000);
            console.log("  ✓ 已点击使用");
          } else {
            // 后备：点击卡片 + 面板底部确定
            await targetCard.click();
            await page.waitForTimeout(1000);
            console.log("  → 已点击卡片");
            const confirmBtn = page.locator('.semi-modal-content button:has-text("确定"), button:has-text("确定")').last();
            if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              await confirmBtn.click();
              await page.waitForTimeout(2000);
              console.log("  ✓ 已点击确定");
            }
          }

          await report(page, "06-music-selected");
        } else {
          console.log("  ⚠️ 未找到音乐项，检查页面结构");
        }

        await report(page, "06-hot-list-loaded");
      } else {
        console.log("  ⚠️ 未找到热门榜标签");
      }

      await report(page, "06-music-panel-done");
    } else {
      console.log("  ⚠️ 未找到选择音乐按钮");
    }

    await report(page, "07-final");
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
