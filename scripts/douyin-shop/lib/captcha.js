// 常见容器选择器（用于判断滑块是否出现）
const DIALOG_SELECTORS = [
  "text=请完成下列验证后继续",
  ".captcha_verify_container",
  ".captcha-verify-container",
  ".verify-modal",
  'div[class*="captcha"][class*="container"]'
];

// 背景图（带缺口）常见选择器
const BG_IMAGE_SELECTORS = [
  "img.captcha-verify-image",
  "img.captcha_verify_img--wrapper",
  "img.captcha_verify_img",
  'img[class*="captcha"][class*="bg"]',
  'img[class*="verify"][class*="img"]'
];

// 滑动按钮常见选择器
const SLIDER_BUTTON_SELECTORS = [
  ".secsdk-captcha-drag-icon",
  "#captcha_slider_button",
  ".captcha_verify_slide--button",
  'div[class*="drag"][class*="icon"]',
  'div[class*="slider"][class*="button"]',
  'span[class*="drag"][class*="btn"]'
];

async function firstVisibleLocator(scope, selectors, timeout = 500) {
  for (const sel of selectors) {
    const loc = scope.locator(sel).first();
    if (await loc.isVisible({ timeout }).catch(() => false)) {
      return loc;
    }
  }
  return null;
}

async function findCaptchaScope(page) {
  const dialog = await firstVisibleLocator(page, DIALOG_SELECTORS, 400);
  if (dialog) {
    const bg = await firstVisibleLocator(page, BG_IMAGE_SELECTORS, 400);
    const btn = await firstVisibleLocator(page, SLIDER_BUTTON_SELECTORS, 400);
    if (bg && btn) {
      return { scope: page, bg, btn };
    }
  }

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const bg = await firstVisibleLocator(frame, BG_IMAGE_SELECTORS, 400);
    const btn = await firstVisibleLocator(frame, SLIDER_BUTTON_SELECTORS, 400);
    if (bg && btn) {
      return { scope: frame, bg, btn };
    }
  }

  const bg = await firstVisibleLocator(page, BG_IMAGE_SELECTORS, 400);
  const btn = await firstVisibleLocator(page, SLIDER_BUTTON_SELECTORS, 400);
  if (bg && btn) {
    return { scope: page, bg, btn };
  }

  return null;
}

async function isCaptchaVisible(page) {
  return Boolean(await findCaptchaScope(page));
}

async function waitForCaptchaAppear(page, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await findCaptchaScope(page);
    if (found) return found;

    const url = page.url() || "";
    if (
      url.includes("/ffa/") ||
      url.includes("/mshop") ||
      url.includes("compass.jinritemai.com") ||
      (url.includes("jinritemai.com") && !url.includes("/login/common"))
    ) {
      return null;
    }

    const onPicker = await page
      .locator("text=请选择店铺")
      .first()
      .isVisible({ timeout: 120 })
      .catch(() => false);
    if (onPicker) return null;

    await page.waitForTimeout(200);
  }
  return null;
}

async function solveCaptchaIfPresent(page, options = {}) {
  const { tag = "shop" } = options;

  const appeared = await waitForCaptchaAppear(page, 2500);
  if (!appeared) {
    return true;
  }

  console.warn(
    `[${tag}] 检测到滑块验证码，已禁用自动拖动；请在浏览器中手动完成验证，脚本会继续等待登录成功。`
  );
  return false;
}

module.exports = {
  findCaptchaScope,
  isCaptchaVisible,
  solveCaptchaIfPresent
};
