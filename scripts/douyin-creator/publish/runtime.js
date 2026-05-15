const {
  isLoggedInAtTarget,
  isVerificationUiVisible,
  notifyLoginRequired,
  waitForManualLoginFlow
} = require("../lib/login");
const { saveAuth } = require("../lib/exporter");
const { TARGET_URL, PUBLISH_WAIT_MULTIPLIER } = require("../lib/env");
const { step, checkOk } = require("./logger");

// ---- 自动慢网识别 ----

/** 已校准的倍率，null 表示尚未校准 */
let _calibratedMultiplier = null;

/** 首次 networkidle 的基准耗时（毫秒），低于此值视为快网 */
const NETWORK_IDLE_BASELINE_MS = 3000;

/** 最终使用的倍率 = max(环境变量, 自动校准)，上限 5 */
function scaledMs(ms) {
  if (_calibratedMultiplier === null) {
    return Math.round(ms * PUBLISH_WAIT_MULTIPLIER);
  }
  const m = Math.max(PUBLISH_WAIT_MULTIPLIER, _calibratedMultiplier);
  return Math.round(ms * Math.min(m, 5));
}

function networkLabel(multiplier) {
  if (multiplier <= 1.0) return "流畅";
  if (multiplier <= 1.5) return "一般";
  if (multiplier <= 2.5) return "较慢";
  if (multiplier <= 4.0) return "缓慢";
  return "极慢";
}

/**
 * 自动校准网络速度。在首次大页面加载后调用一次即可。
 * 测量 networkidle 耗时 vs 基准，自动提升后续等待倍率。
 */
async function calibrateNetworkSpeed(
  page,
  { baselineMs = NETWORK_IDLE_BASELINE_MS } = {}
) {
  if (_calibratedMultiplier !== null) return;
  try {
    const start = Date.now();
    await page.waitForLoadState("networkidle").catch(() => {});
    const elapsed = Date.now() - start;
    const computed = Math.min(
      Math.max(1, Math.round((elapsed / baselineMs) * 10) / 10),
      5
    );
    _calibratedMultiplier = computed;

    const envNote =
      PUBLISH_WAIT_MULTIPLIER > 1
        ? `（环境变量强制 ×${PUBLISH_WAIT_MULTIPLIER}）`
        : "";
    console.log(
      `[网络环境] ${networkLabel(getCalibratedMultiplier())} | ` +
        `networkidle ${elapsed}ms / 基准 ${baselineMs}ms → 倍率 ×${_calibratedMultiplier}${envNote}`
    );
  } catch {
    _calibratedMultiplier = 1;
    console.log("[网络环境] 校准失败，使用默认倍率 ×1.0");
  }
}

/** 返回当前生效的倍率（调试用） */
function getCalibratedMultiplier() {
  return _calibratedMultiplier === null
    ? PUBLISH_WAIT_MULTIPLIER
    : Math.max(PUBLISH_WAIT_MULTIPLIER, _calibratedMultiplier);
}

// ---- 工具函数 ----

async function waitForPageSettled(page, opts = {}) {
  const { afterClick = true, minWaitMs = 500 } = opts;
  if (afterClick) {
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  await page.waitForTimeout(scaledMs(minWaitMs));
}

async function waitForLoginCheckToSettle(page, accountName) {
  let y = 3;
  for (let i = 0; i < y; i += 1) {
    if (await isLoggedInAtTarget(page)) {
      return "logged_in";
    }
    if (await isVerificationUiVisible(page)) {
      return "login_required";
    }

    console.log(
      `账号 [${accountName}] 登录态暂未确认，等待页面稳定... (${i + 1}/${y})`
    );
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(scaledMs(1500));
  }

  await page
    .goto(TARGET_URL, { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(scaledMs(1500));

  if (await isLoggedInAtTarget(page)) {
    return "logged_in";
  }
  if (await isVerificationUiVisible(page)) {
    return "login_required";
  }

  return "unknown";
}

async function ensureLoggedIn(page, accountName, paths) {
  console.log(`检查账号 [${accountName}] 登录状态...`);
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  // 利用首帧加载自动校准慢网倍率（后续所有等待自动适配）
  await calibrateNetworkSpeed(page);
  await waitForPageSettled(page, { afterClick: false, minWaitMs: 3000 });

  if (await isLoggedInAtTarget(page)) {
    console.log(`账号 [${accountName}] 登录态有效`);
    return;
  }

  const loginStatus = await waitForLoginCheckToSettle(page, accountName);
  if (loginStatus === "logged_in") {
    console.log(`账号 [${accountName}] 登录态有效`);
    return;
  }

  const reason = "cookies/storageState 失效或已过期";
  if (loginStatus === "login_required") {
    console.log(
      `账号 [${accountName}] 检测到登录/验证页面，${reason}，进入登录流程`
    );
  } else {
    console.log(
      `账号 [${accountName}] 未能确认登录态，${reason}，进入登录流程`
    );
  }
  await notifyLoginRequired(page, paths, accountName, reason);
  await waitForManualLoginFlow(page, paths, accountName, reason);

  console.log(`账号 [${accountName}] 登录流程完成，验证状态...`);
  await page.goto(TARGET_URL, { waitUntil: "networkidle" });
  await waitForPageSettled(page, { afterClick: false, minWaitMs: 3000 });

  for (let i = 0; i < 3; i += 1) {
    if (await isLoggedInAtTarget(page)) break;
    console.log(`  验证未通过，等待渲染... (${i + 1}/3)`);
    await waitForPageSettled(page, { afterClick: false, minWaitMs: 3000 });
  }

  if (!(await isLoggedInAtTarget(page))) {
    throw new Error(`账号 ${accountName} 登录验证未通过`);
  }

  await saveAuth(page.context(), paths, accountName);
  console.log(`账号 [${accountName}] 登录态已保存`);
}

async function closeCreatorGuides(page) {
  const buttons = [
    'button:has-text("我知道了")',
    'button:has-text("知道了")',
    'button:has-text("跳过")'
  ];
  for (const selector of buttons) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

async function scrollPublishFormToBottom(page) {
  await closeCreatorGuides(page);
  await page
    .evaluate(() => {
      const canScroll = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return (
          el.scrollHeight > el.clientHeight + 40 &&
          /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`)
        );
      };

      const candidates = Array.from(
        document.querySelectorAll("main, section, div")
      )
        .filter(canScroll)
        .map((el) => {
          const text = el.textContent || "";
          const score =
            (text.includes("发布设置") ? 5 : 0) +
            (text.includes("暂存离开") ? 4 : 0) +
            (text.includes("定时发布") ? 3 : 0) +
            (text.includes("作品描述") ? 2 : 0) +
            Math.min(el.scrollHeight - el.clientHeight, 2000) / 2000;
          return { el, score };
        })
        .sort((a, b) => b.score - a.score);

      const target =
        candidates[0]?.el ||
        document.scrollingElement ||
        document.documentElement;
      target.scrollTop = target.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    })
    .catch(() => {});
  await page.waitForTimeout(scaledMs(500));
}

async function optimizePublishPageForViewing(page) {
  await closeCreatorGuides(page);
  const envZoom = Number(process.env.PUBLISH_PAGE_ZOOM);
  const zoom =
    Number.isFinite(envZoom) && envZoom >= 0.6 && envZoom <= 1.2
      ? envZoom
      : 0.65;
  await page
    .evaluate((value) => {
      document.documentElement.style.zoom = String(value);
      document.body.style.zoom = "";
    }, zoom)
    .catch(() => {});
  await page.waitForTimeout(300);
}

async function clickPublishButton(page) {
  console.log("点击发布按钮...");
  await scrollPublishFormToBottom(page);

  const publishBtn = page
    .locator(
      [
        'button.primary-cECiOJ:has-text("发布")',
        'button.fixed-J9O8Yw:has-text("发布")',
        'button:has-text("发布"):not(:has-text("定时")):not(:has-text("高清"))'
      ].join(", ")
    )
    .first();

  if (
    !(await publishBtn
      .isVisible({ timeout: scaledMs(5000) })
      .catch(() => false))
  ) {
    console.log("  ⚠️ 未找到发布按钮，可能已自动发布或按钮被遮挡");
    return false;
  }

  const isDisabled = await publishBtn.isDisabled().catch(() => false);
  if (isDisabled) {
    console.log("  ⚠️ 发布按钮处于禁用状态，可能必填字段未填写完成");
    return false;
  }

  await publishBtn.scrollIntoViewIfNeeded().catch(() => {});
  await publishBtn.click();
  console.log("  ✓ 已点击发布按钮");

  await page.waitForTimeout(scaledMs(3000));

  const toastSelector =
    '.semi-toast-content, .semi-message, [class*="toast"], [class*="message"]';
  try {
    const toast = await page
      .waitForSelector(toastSelector, { timeout: scaledMs(25000) })
      .catch(() => null);
    if (toast) {
      const toastText = await toast.textContent().catch(() => "");
      console.log(`  提示信息: ${toastText.slice(0, 100)}`);
      if (toastText.includes("发布成功") || toastText.includes("success")) {
        console.log("  ✅ 发布成功");
        return true;
      }
      if (
        toastText.includes("失败") ||
        toastText.includes("错误") ||
        toastText.includes("违规")
      ) {
        throw new Error(`发布失败: ${toastText.slice(0, 200)}`);
      }
    }
  } catch (e) {
    if (e.message.startsWith("发布失败")) throw e;
  }

  const stillVisible = await publishBtn.isVisible().catch(() => false);
  if (stillVisible) {
    console.log("  ⚠️ 发布按钮仍在，可能发布未完成");
    return false;
  }

  console.log("  ✅ 发布已提交（按钮已隐藏）");
  return true;
}

// ===== 单步校验函数：每个填写步骤完成后立即调用，失败则抛错 =====

async function checkVideoUploaded(page) {
  const selectors = [
    "video",
    '[class*="cover-"]',
    'img[src*="creator-media-private.douyin.com"]',
    'img[src^="blob:"]'
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
      checkOk(`视频素材校验通过 (${sel})`);
      return;
    }
  }
  throw new Error("视频素材校验失败：未检测到视频预览或封面渲染");
}

async function checkImagesUploaded(page, expectedCount) {
  if (!expectedCount || expectedCount <= 0) {
    checkOk("图文素材校验通过 (无图片)");
    return;
  }

  for (let attempt = 0; attempt < 15; attempt++) {
    // 页面编辑区"已添加X张图片" + 旁边的"继续添加"按钮，双重确认区域正确
    const countText = await page
      .locator("text=/已添加(\\d+)张图片/")
      .first()
      .textContent()
      .catch(() => "");
    const nearby = await page
      .locator('button:has-text("继续添加")')
      .first()
      .isVisible()
      .catch(() => false);
    const count = (() => {
      const m = countText.match(/已添加(\d+)张图片/);
      return m && nearby ? parseInt(m[1], 10) : 0;
    })();

    if (count >= expectedCount) {
      checkOk(`图文素材校验通过 (${count}张)`);
      return;
    }
    await page.waitForTimeout(2000);
  }

  throw new Error(
    `图文素材校验失败：期望 ${expectedCount} 张，未匹配到足够图片`
  );
}

async function checkTitleFilled(page, expectedTitle) {
  if (!expectedTitle) return;
  const titleInput = page
    .locator('input[placeholder*="标题"], input[placeholder*="作品标题"]')
    .first();
  const actual = (await titleInput.inputValue().catch(() => "")).trim();
  if (actual) {
    checkOk("标题校验通过");
    return;
  }
  throw new Error(`标题校验失败：输入框为空，期望: ${expectedTitle}`);
}

async function checkBodyFilled(page, expectedBody) {
  if (!expectedBody) return;
  const editor = page.locator('[contenteditable="true"]').first();
  const text = (await editor.textContent().catch(() => "")).trim();
  // 编辑器内通过 Enter 换行会插入零宽空格，替换为空格后再比较（与 \n 行为一致）
  const clean = (s) =>
    s
      .replace(/[​‌‍﻿]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  if (text && clean(text).includes(clean(expectedBody.slice(0, 20)))) {
    checkOk("正文校验通过");
    return;
  }
  throw new Error(`正文校验失败：编辑器内未找到期望正文 "${expectedBody}"`);
}

async function checkHashtagsSet(page, expectedHashtags) {
  if (!expectedHashtags || expectedHashtags.length === 0) return;

  const topicEls = page.locator(
    '[data-mention="#"] span, [class*="topic"], [class*="hashtag"]'
  );
  const topicCount = await topicEls.count().catch(() => 0);
  const topicTexts = [];
  for (let i = 0; i < topicCount; i++) {
    const t = (
      await topicEls
        .nth(i)
        .textContent()
        .catch(() => "")
    ).trim();
    if (t) topicTexts.push(t);
  }

  let matchedCount = 0;
  const unmatched = [];
  for (const expected of expectedHashtags) {
    const clean = expected.replace(/\s+/g, "");
    if (
      topicTexts.some(
        (t) =>
          t.replace(/\s+/g, "").includes(clean) ||
          clean.includes(t.replace(/\s+/g, ""))
      )
    ) {
      matchedCount++;
    } else {
      unmatched.push(expected);
    }
  }

  if (matchedCount === expectedHashtags.length) {
    checkOk(`话题标签校验通过 (${matchedCount}个)`);
    return;
  }
  throw new Error(
    `话题标签校验失败：${matchedCount}/${expectedHashtags.length} 匹配` +
      `，缺失: ${unmatched.join(", ")}` +
      `，实际: ${topicTexts.join(", ") || "(空)"}`
  );
}

async function checkScheduleSet(page) {
  const dateInput = page
    .locator('.semi-datepicker input, input[placeholder*="日期"]')
    .first();
  const actual = (await dateInput.inputValue().catch(() => "")).trim();
  if (actual) {
    checkOk(`定时发布校验通过 (${actual})`);
    return;
  }
  throw new Error("定时发布校验失败：日期选择器为空");
}

async function checkProductLinkSet(page) {
  const issues = [];

  // 1. 检查购物车下拉框是否已选中（通过 .semi-select-selection-text 内文本或 select-dropdown-option-img）
  const cartSelectors = [
    '.semi-select-selection-text:has-text("购物车")',
    '[class*="select-dropdown-option"]:has-text("购物车")',
    '[class*="selectText"]:has-text("购物车")'
  ];
  let cartSelected = false;
  for (const sel of cartSelectors) {
    if (
      await page
        .locator(sel)
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false)
    ) {
      cartSelected = true;
      break;
    }
  }
  if (!cartSelected) issues.push("购物车未选中");

  // 2. 检查是否已添加商品（完成后输入框会被清空，商品出现在 cart-container 中）
  const productAddedSelectors = [
    '[class*="cart-item"]',
    '[class*="cart-container"]',
    "text=已添加商品"
  ];
  let productAdded = false;
  for (const sel of productAddedSelectors) {
    if (
      await page
        .locator(sel)
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false)
    ) {
      productAdded = true;
      break;
    }
  }
  // 备用：如果商品卡片没出现，检查链接输入框是否还有值（弹窗未关闭的中间状态）
  if (!productAdded) {
    const linkInput = page.locator('input[placeholder*="粘贴商品"]').first();
    const linkValue = (await linkInput.inputValue().catch(() => "")).trim();
    if (linkValue) {
      step("商品链接已填入但弹窗可能未关闭");
    } else {
      issues.push("未检测到已添加的商品");
    }
  }

  if (issues.length === 0) {
    checkOk("购物车链接校验通过");
  } else {
    throw new Error(`购物车链接校验失败：${issues.join("; ")}`);
  }

  // 3. 检查编辑弹窗是否已关闭
  const finishBtn = page.locator('button:has-text("完成编辑")').first();
  if (!(await finishBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
    checkOk("商品编辑校验通过");
  } else {
    throw new Error("商品编辑校验失败：编辑弹窗未关闭（完成编辑按钮仍可见）");
  }
}

async function checkSelfDeclarationSet(page, isAiContent) {
  const targetLabel = isAiContent ? "内容由AI生成" : "无需添加自主声明";
  const section = page
    .locator('section:has(.title-cnbkZe:has-text("自主声明"))')
    .first();
  if (!(await section.isVisible({ timeout: 2000 }).catch(() => false))) {
    checkOk("自主声明校验通过 (未找到声明区域)");
    return;
  }
  const currentText = (
    await section
      .locator('[class*="selectText"]')
      .first()
      .textContent()
      .catch(() => "")
  ).trim();
  if (currentText && currentText.includes(targetLabel)) {
    checkOk(`自主声明校验通过 (${targetLabel})`);
    return;
  }
  throw new Error(
    `自主声明校验失败：期望 "${targetLabel}"，实际 "${currentText || "(空)"}"`
  );
}

async function checkMusicSelected(page) {
  // 配乐区域有两个"选择音乐"文本：标题区 title-content-oaqcSp 和操作区 action-Q1y01k
  // 选中后标题区保持不变，操作区文字会变成歌曲名
  const actionSpan = page
    .locator('span[class*="action"]:has-text("选择音乐")')
    .first();
  const stillDefault = await actionSpan
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  if (!stillDefault) {
    checkOk("配乐校验通过");
    return;
  }

  // 操作区仍显示"选择音乐"，检查默认占位文字是否已消失
  const placeholder = page.locator("text=点击添加合适作品风格音乐").first();
  const placeholderGone = !(await placeholder
    .isVisible({ timeout: 1000 })
    .catch(() => false));

  if (placeholderGone) {
    checkOk("配乐校验通过 (占位文字已消失)");
    return;
  }

  throw new Error("配乐校验失败：未检测到已选配乐");
}

module.exports = {
  scaledMs,
  waitForPageSettled,
  calibrateNetworkSpeed,
  getCalibratedMultiplier,
  ensureLoggedIn,
  closeCreatorGuides,
  scrollPublishFormToBottom,
  optimizePublishPageForViewing,
  clickPublishButton,
  checkVideoUploaded,
  checkImagesUploaded,
  checkTitleFilled,
  checkBodyFilled,
  checkHashtagsSet,
  checkScheduleSet,
  checkProductLinkSet,
  checkSelfDeclarationSet,
  checkMusicSelected
};
