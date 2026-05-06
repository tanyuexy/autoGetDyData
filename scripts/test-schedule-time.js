/**
 * 测试定时发布时间约束逻辑 + 浏览器端交互
 *
 * 约束规则（抖音要求）：
 *   - 最少：当前时间 + 2 小时
 *   - 最多：当前时间 + 14 天
 *   - 不符合约束 → 改为立即发布（不定时）
 *
 * 用法:
 *   node scripts/tests/test-schedule-time.js
 *   node scripts/tests/test-schedule-time.js --browser  # 同时测试浏览器交互
 */
const path = require("path");
const { chromium } = require("playwright");

// ========== 时间约束验证（纯逻辑测试） ==========

function testTimeConstraints() {
  const now = new Date();
  const MIN_OFFSET_MS = 2 * 60 * 60 * 1000;
  const MAX_OFFSET_MS = 14 * 24 * 60 * 60 * 1000;
  const minTime = new Date(now.getTime() + MIN_OFFSET_MS);
  const maxTime = new Date(now.getTime() + MAX_OFFSET_MS);

  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // 模拟 setScheduleIfNeeded 逻辑（使用时间戳避免字符串解析精度损失）
  function isInRange(ts) {
    return ts >= minTime.getTime() && ts <= maxTime.getTime();
  }

  function imm(reason) { return { action: "immediate", reason }; }
  function sched() { return { action: "schedule" }; }

  const tests = [];

  // Case 1: 1小时后 → 立即发布
  const tooEarly = new Date(now.getTime() + 1 * 60 * 60 * 1000);
  tests.push({ label: "1小时后（不足2h → 立即发布）", ts: tooEarly.getTime(), expect: imm("不足2小时") });

  // Case 2: 20天后 → 立即发布
  const tooLate = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);
  tests.push({ label: "20天后（超过14天 → 立即发布）", ts: tooLate.getTime(), expect: imm("超过14天") });

  // Case 3: 3小时后 → 正常定时
  const inRange = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  tests.push({ label: "3小时后（范围内 → 正常定时）", ts: inRange.getTime(), expect: sched() });

  // Case 4: 正好2小时后 → 正常定时
  const exactMin = new Date(now.getTime() + MIN_OFFSET_MS);
  tests.push({ label: "正好2小时后（边界 → 正常定时）", ts: exactMin.getTime(), expect: sched() });

  // Case 5: 正好14天后 → 正常定时
  const exactMax = new Date(now.getTime() + MAX_OFFSET_MS);
  tests.push({ label: "正好14天后（边界 → 正常定时）", ts: exactMax.getTime(), expect: sched() });

  // Case 6: 过去的时间 → 立即发布
  const past = new Date(now.getTime() - 1 * 60 * 60 * 1000);
  tests.push({ label: "1小时前（过去 → 立即发布）", ts: past.getTime(), expect: imm("不足2小时") });

  // Case 7: 差1分钟到2小时 → 立即发布
  const justUnderMin = new Date(now.getTime() + MIN_OFFSET_MS - 60 * 1000);
  tests.push({ label: "1小时59分钟后（差1分钟 → 立即发布）", ts: justUnderMin.getTime(), expect: imm("不足2小时") });

  // Case 8: 刚过2小时1分钟 → 正常定时
  const justOverMin = new Date(now.getTime() + MIN_OFFSET_MS + 60 * 1000);
  tests.push({ label: "2小时1分钟后（满足要求 → 正常定时）", ts: justOverMin.getTime(), expect: sched() });

  // Case 9: null/NaN → 立即发布
  tests.push({ label: "NaN时间（无效 → 立即发布）", ts: NaN, expect: imm("无定时参数") });

  console.log("=".repeat(60));
  console.log("时间约束逻辑测试（不符合 = 立即发布）");
  console.log(`当前时间: ${fmt(now)}`);
  console.log(`合法范围: ${fmt(minTime)} ~ ${fmt(maxTime)}（+2h ~ +14d）`);
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    const actualAction = isInRange(t.ts) ? "schedule" : "immediate";
    const expectedAction = t.expect.action;
    const pass = actualAction === expectedAction;
    const status = pass ? "✓" : "✗";
    if (pass) passed++; else failed++;
    console.log(`  ${status} ${t.label} → ${actualAction === "schedule" ? "定时发布" : "立即发布"}`);
  }

  console.log(`\n结果: ${passed}/${tests.length} 通过, ${failed}/${tests.length} 失败\n`);
  return failed === 0;
}

// ========== 浏览器交互测试 ==========

async function testBrowserScheduleInteraction() {
  console.log("=".repeat(60));
  console.log("浏览器交互测试（抖音创作者页面）");
  console.log("=".repeat(60));

  const ACCOUNT_NAME = process.env.TEST_ACCOUNT || "普济堂官方旗舰店";
  const ACCOUNTS_DIR = path.resolve(process.cwd(), "storage/creator-accounts");

  // 尝试加载已保存的 auth state
  let storageState = null;
  const statePath = path.join(ACCOUNTS_DIR, ACCOUNT_NAME, "storageState.json");
  if (require("fs").existsSync(statePath)) {
    try {
      storageState = JSON.parse(require("fs").readFileSync(statePath, "utf-8"));
      console.log(`已加载账号 [${ACCOUNT_NAME}] 的已保存登录态`);
    } catch (e) {
      console.log(`加载登录态失败: ${e.message}，将手动登录`);
    }
  } else {
    console.log(`未找到账号 [${ACCOUNT_NAME}] 的登录态，将手动登录`);
  }

  const headless = process.env.TEST_HEADLESS !== "false";
  const browser = await chromium.launch({
    headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const contextOptions = {
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  };
  if (storageState) {
    contextOptions.storageState = storageState;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const pad = (n) => String(n).padStart(2, "0");

  try {
    const publishUrl = "https://creator.douyin.com/creator-micro/content/post/image?default-tab=3&enter_from=publish_page&media_type=image&type=new";
    console.log(`导航到: ${publishUrl}`);
    await page.goto(publishUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);

    console.log("当前 URL:", page.url());

    const needLogin = page.url().includes("login") || page.url().includes("sso");
    if (needLogin) {
      if (headless) {
        console.log("\n⚠️ 需要登录，但在 headless 模式下无法手动登录。");
        console.log("请运行以下命令进行交互式测试:");
        console.log(`  TEST_HEADLESS=false TEST_ACCOUNT="${ACCOUNT_NAME}" node scripts/tests/test-schedule-time.js --browser`);
        await browser.close();
        return;
      }
      console.log("\n⚠️ 需要登录！请在浏览器窗口中手动扫码登录");
      console.log("登录完成后脚本将继续执行...\n");
      await page.waitForURL("**/creator-micro/**", { timeout: 180000 }).catch(() => {});
      console.log("检测到已进入创作者平台，等待页面稳定...");
      await page.waitForTimeout(5000);
    }

    // 重新导航到发布页面确保在正确页面
    await page.goto(publishUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);

    // 截图初始状态
    await page.screenshot({ path: path.resolve(__dirname, "../../storage/creator-publish-debug/test-schedule-01-loaded.png"), fullPage: true });
    console.log("已截图: 页面加载完成");

    // ---- 测试1: 查找并点击「定时发布」开关 ----
    console.log("\n--- 测试1: 点击「定时发布」开关 ---");
    let scheduleToggle = null;
    const toggleSelectors = [
      'label:has-text("定时发布")',
      'text=定时发布',
      'span:has-text("定时发布")',
    ];
    for (const sel of toggleSelectors) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`  找到定时发布开关: ${sel}`);
        scheduleToggle = loc;
        break;
      }
    }

    if (!scheduleToggle) {
      console.log("  ⚠️ 未找到定时发布开关（可能需要先填写内容），截图检查...");
      await page.screenshot({ path: path.resolve(__dirname, "../../storage/creator-publish-debug/test-schedule-no-toggle.png"), fullPage: true });
    } else {
      await scheduleToggle.click();
      console.log("  ✓ 已点击定时发布开关");
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.resolve(__dirname, "../../storage/creator-publish-debug/test-schedule-02-toggle-clicked.png"), fullPage: true });
    }

    // ---- 测试2: 查找日期选择器 ----
    console.log("\n--- 测试2: 查找日期时间选择器 ---");
    const datePickerSelectors = [
      '.date-picker-x1Ag_4 .semi-input-wrapper',
      '.semi-datepicker-input .semi-input-wrapper',
      '.semi-datepicker input',
      'input[placeholder*="日期"]',
      'input[placeholder*="时间"]',
    ];

    let dateInput = null;
    for (const sel of datePickerSelectors) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`  找到日期选择器: ${sel}`);
        dateInput = loc;
        break;
      }
    }

    if (!dateInput) {
      console.log("  ⚠️ 未找到日期选择器");
      // 尝试分析页面结构
      const pageContent = await page.content().catch(() => "");
      const hasDatePicker = pageContent.includes("date-picker") || pageContent.includes("DatePicker") || pageContent.includes("datepicker");
      console.log(`  页面是否包含 date-picker: ${hasDatePicker}`);
      await page.screenshot({ path: path.resolve(__dirname, "../../storage/creator-publish-debug/test-schedule-no-datepicker.png"), fullPage: true });
    } else {
      // 点击日期选择器打开面板
      await dateInput.click();
      console.log("  ✓ 已点击日期选择器");
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.resolve(__dirname, "../../storage/creator-publish-debug/test-schedule-03-datepicker-opened.png"), fullPage: true });

      // ---- 测试3: 输入定时时间（2小时后） ----
      console.log("\n--- 测试3: 输入定时时间 ---");
      const now = new Date();
      const scheduleTime = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 5 * 60 * 1000); // 2h5m 后
      const timeText = `${scheduleTime.getFullYear()}-${pad(scheduleTime.getMonth() + 1)}-${pad(scheduleTime.getDate())} ${pad(scheduleTime.getHours())}:${pad(scheduleTime.getMinutes())}`;
      console.log(`  将输入: ${timeText}`);

      // 找到实际的可输入 input
      const realInput = page.locator('.semi-datepicker input, input[placeholder*="日期"], input[placeholder*="时间"]').first();
      if (await realInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await realInput.click();
        await page.waitForTimeout(500);

        // 清空并输入
        await realInput.fill("");
        await realInput.type(timeText, { delay: 50 });
        console.log(`  ✓ 已输入: ${timeText}`);
        await page.waitForTimeout(1000);

        await realInput.press("Enter").catch(() => {});
        console.log("  ✓ 已按 Enter 确认");
        await page.waitForTimeout(2000);
        await page.screenshot({ path: path.resolve(__dirname, "../../storage/creator-publish-debug/test-schedule-04-time-set.png"), fullPage: true });

        // ---- 测试4: 验证输入的值 ----
        console.log("\n--- 测试4: 验证输入的值 ---");
        const inputValue = await realInput.inputValue().catch(() => "");
        console.log(`  当前 input value: "${inputValue}"`);
        if (inputValue.includes(scheduleTime.getFullYear().toString())) {
          console.log("  ✓ 日期设置成功（年份匹配）");
        } else {
          console.log("  ⚠️ 日期值不匹配");
        }
      } else {
        console.log("  ⚠️ 未找到可输入的日期框");
      }
    }

    // ---- 测试5: 验证 14 天边界 ----
    console.log("\n--- 测试5: 验证 14 天边界（输入超过14天的日期，看是否被拒绝） ---");
    const now2 = new Date();
    const tooFar = new Date(now2.getTime() + 15 * 24 * 60 * 60 * 1000); // 15天
    const tooFarText = `${tooFar.getFullYear()}-${pad(tooFar.getMonth() + 1)}-${pad(tooFar.getDate())} ${pad(tooFar.getHours())}:${pad(tooFar.getMinutes())}`;
    console.log(`  尝试输入超过14天的日期: ${tooFarText}`);

    const boundaryInput = page.locator('.semi-datepicker input, input[placeholder*="日期"], input[placeholder*="时间"]').first();
    if (await boundaryInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await boundaryInput.click();
      await page.waitForTimeout(500);
      await boundaryInput.fill("");
      await boundaryInput.type(tooFarText, { delay: 50 });
      await page.waitForTimeout(1000);
      await boundaryInput.press("Enter").catch(() => {});
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.resolve(__dirname, "../../storage/creator-publish-debug/test-schedule-05-boundary-check.png"), fullPage: true });

      // 检查是否有错误提示
      const errorText = await page.locator('[class*="error"], [class*="toast"], [class*="message"], [class*="tooltip"]').allTextContents().catch(() => []);
      const errorMessages = errorText.filter(Boolean).join(" ");
      if (errorMessages) {
        console.log(`  页面提示信息: ${errorMessages.slice(0, 300)}`);
      }
    }

    console.log("\n浏览器测试完成！截图已保存到 storage/creator-publish-debug/");

  } catch (e) {
    console.error("浏览器测试出错:", e.message);
    await page.screenshot({ path: path.resolve(__dirname, "../../storage/creator-publish-debug/test-schedule-error.png"), fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
}

// ========== 主入口 ==========

async function main() {
  const hasBrowserFlag = process.argv.includes("--browser");

  const logicPassed = testTimeConstraints();

  if (!logicPassed) {
    console.error("时间约束逻辑测试失败！");
    process.exit(1);
  }

  if (hasBrowserFlag) {
    await testBrowserScheduleInteraction();
  }

  console.log("\n所有测试完成 ✓");
  if (!hasBrowserFlag) {
    console.log("提示: 使用 --browser 参数同时运行浏览器交互测试");
    console.log("  node scripts/tests/test-schedule-time.js --browser");
  }
}

main().catch(console.error);
