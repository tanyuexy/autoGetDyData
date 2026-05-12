const {
  isLoggedInAtTarget,
  isVerificationUiVisible,
  notifyLoginRequired,
  waitForManualLoginFlow
} = require("../lib/login");
const { saveAuth } = require("../lib/exporter");
const { TARGET_URL } = require("../lib/env");

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
    await page.waitForTimeout(1500);
  }

  await page
    .goto(TARGET_URL, { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);

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
  await page.waitForTimeout(3000);

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
  await page.waitForTimeout(3000);

  for (let i = 0; i < 3; i += 1) {
    if (await isLoggedInAtTarget(page)) break;
    console.log(`  验证未通过，等待渲染... (${i + 1}/3)`);
    await page.waitForTimeout(3000);
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
  await page.waitForTimeout(500);
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

  if (!(await publishBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
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

  await page.waitForTimeout(3000);

  const toastSelector =
    '.semi-toast-content, .semi-message, [class*="toast"], [class*="message"]';
  try {
    const toast = await page
      .waitForSelector(toastSelector, { timeout: 25000 })
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

module.exports = {
  ensureLoggedIn,
  closeCreatorGuides,
  scrollPublishFormToBottom,
  optimizePublishPageForViewing,
  clickPublishButton
};
