const path = require("path");
const fs = require("fs/promises");

const { detectGapX } = require("./image");
const { humanDrag } = require("./human-drag");
const { SLIDER_DRAG_DURATION_MS } = require("./env");

function manualCaptchaTrackScale() {
  const raw = process.env.SHOP_CAPTCHA_TRACK_SCALE;
  if (raw == null || String(raw).trim() === "") return null;
  const v = parseFloat(String(raw).trim());
  if (!Number.isFinite(v) || v < 0.4 || v > 1.8) return null;
  return v;
}

/**
 * 抖店/字节跳动滑块验证码处理。
 *
 * 验证码 DOM 分析（观察所得，可能随版本微调）：
 * - 外层弹窗：<div>请完成下列验证后继续</div> 的父容器
 * - 背景图 <img>：带缺口的拼图底图
 * - 前景 piece <img>：需要拖入缺口的小拼图块（transparent png）
 * - 滑条轨道：底部整条“按住左边按钮拖动完成上方拼图”
 * - 滑条按钮：左侧可拖动的按钮（内含 → 图标）
 *
 * 不同版本选择器会变，这里使用多层兜底。
 */

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

// piece（小拼图块）常见选择器
const PIECE_IMAGE_SELECTORS = [
  "img.captcha_verify_img_slide",
  'img[class*="captcha"][class*="slide"]',
  'img[class*="verify"][class*="piece"]'
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

// 刷新按钮（验证失败后重试用）
const REFRESH_SELECTORS = [
  "text=刷新",
  ".secsdk_captcha_refresh",
  'div[class*="refresh"]'
];

/**
 * 依次尝试选择器，返回第一个可见元素的 locator；都不可见返回 null
 */
async function firstVisibleLocator(scope, selectors, timeout = 500) {
  for (const sel of selectors) {
    const loc = scope.locator(sel).first();
    if (await loc.isVisible({ timeout }).catch(() => false)) {
      return loc;
    }
  }
  return null;
}

/**
 * 识别滑块验证是否出现；返回一个可操作 scope（page 或 iframe），以及关键元素。
 * 如果验证在 iframe 里（有时会），优先在 iframe 里查找。
 */
async function findCaptchaScope(page) {
  // 1) 先尝试主 document
  const dialog = await firstVisibleLocator(page, DIALOG_SELECTORS, 400);
  if (dialog) {
    const bg = await firstVisibleLocator(page, BG_IMAGE_SELECTORS, 400);
    const btn = await firstVisibleLocator(page, SLIDER_BUTTON_SELECTORS, 400);
    if (bg && btn) {
      return { scope: page, bg, btn };
    }
  }

  // 2) 扫描每个 frame
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const bg = await firstVisibleLocator(frame, BG_IMAGE_SELECTORS, 400);
    const btn = await firstVisibleLocator(frame, SLIDER_BUTTON_SELECTORS, 400);
    if (bg && btn) {
      return { scope: frame, bg, btn };
    }
  }

  // 3) 主 document 里只要有 bg + btn 两个关键元素就算出现
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
    // 如果页面已经跳走（登录成功），就不必再等滑块
    const url = page.url() || "";
    if (
      url.includes("/ffa/") ||
      url.includes("/mshop") ||
      url.includes("compass.jinritemai.com") ||
      // 抖店/罗盘通用的"请选择店铺"页面（URL 可能是 xxx/login/role 等形式）
      (url.includes("jinritemai.com") && !url.includes("/login/common"))
    ) {
      return null;
    }
    // 页面里出现"请选择店铺"也视为登录成功，提前结束等待
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

/**
 * 等待验证弹窗消失（视为通过）。
 */
async function waitForCaptchaDisappear(page, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isCaptchaVisible(page))) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

/**
 * 点击刷新按钮以重置滑块。
 */
async function refreshCaptcha(scopeOrPage) {
  for (const sel of REFRESH_SELECTORS) {
    const loc = scopeOrPage.locator(sel).first();
    if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
      await loc.click().catch(() => {});
      return true;
    }
  }
  return false;
}

/**
 * 把 locator 对应的元素截图为 Buffer（只裁 bg 区域，避免 piece 干扰）。
 */
async function screenshotElementBuffer(locator) {
  return locator.screenshot({ type: "png" });
}

/**
 * 估算 piece（滑块块）在 bg 图上的实际初始 x 偏移。
 * piece img 可能与 bg img 不同层，需要取它们相对 bg 图的 boundingBox。
 */
async function getPiecePixelWidth(scope) {
  const piece = await firstVisibleLocator(scope, PIECE_IMAGE_SELECTORS, 400);
  if (!piece) return 0;
  const box = await piece.boundingBox().catch(() => null);
  if (!box) return 0;
  return Math.round(box.width);
}

/**
 * 滑轨可拖行程往往略短于背景拼图宽度，需按比例缩放拖动距离。
 * 优先读环境变量 SHOP_CAPTCHA_TRACK_SCALE（例如 0.82）强制覆盖。
 */
async function getSliderTrackScaleFactor(btn, bgDisplayWidth) {
  const manual = manualCaptchaTrackScale();
  if (manual != null) return manual;

  try {
    const ratio = await btn.evaluate((handleEl, bgW) => {
      const minW = Math.max(120, bgW * 0.5);
      const maxW = Math.min(640, bgW * 1.5);
      let cur = handleEl;
      for (let depth = 0; depth < 10 && cur; depth += 1) {
        const r = cur.getBoundingClientRect();
        if (r.width >= minW && r.width <= maxW && r.height < bgW * 0.45) {
          return bgW > 0 ? r.width / bgW : 1;
        }
        cur = cur.parentElement;
      }
      return 1;
    }, bgDisplayWidth);
    if (typeof ratio === "number" && ratio > 0.45 && ratio < 1.55) {
      return ratio;
    }
  } catch {
    // ignore
  }
  return 1;
}

/**
 * 保存调试图（可选）。
 */
async function saveDebugImage(buffer, paths, tag) {
  if (!paths?.debugDir) return;
  try {
    await fs.mkdir(paths.debugDir, { recursive: true });
    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    const file = path.join(paths.debugDir, `captcha-${tag}-${ts}.png`);
    await fs.writeFile(file, buffer);
    return file;
  } catch {
    return null;
  }
}

/** 失败后滑块会回弹到左侧；未回弹时继续拖会累加错位 */
async function waitForSliderHandleReset(page, btn, leftX, maxWaitMs = 4500) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const b = await btn.boundingBox().catch(() => null);
    if (b && b.x <= leftX + 20) return true;
    await page.waitForTimeout(180);
  }
  return false;
}

/**
 * 核心：解决一次滑块验证。
 * @param {import('playwright').Page} page
 * @param {{ scope: any, bg: any, btn: any }} ctx
 * @param {object} options
 * @param {string} [options.tag]       日志 tag（账号名等）
 * @param {object} [options.paths]     路径对象，包含 debugDir
 * @returns {Promise<boolean>}
 */
async function solveOneSlider(page, ctx, options = {}) {
  const { scope, bg, btn } = ctx;
  const tag = options.tag || "shop";

  const bgBox = await bg.boundingBox();
  const btnBox = await btn.boundingBox();
  if (!bgBox || !btnBox) {
    console.warn(`[${tag}] 滑块元素 boundingBox 获取失败，跳过本次求解`);
    return false;
  }

  const bgBuffer = await screenshotElementBuffer(bg);
  await saveDebugImage(bgBuffer, options.paths, "bg");

  // 计算显示尺寸与真实图像尺寸的比例（因为背景图可能是 2x 图）
  const pieceWidth = await getPiecePixelWidth(scope);

  const { gapX, width: imgW, candidates } = await detectGapX(bgBuffer, {
    minStartX: Math.max(60, pieceWidth + 5),
    pieceWidth: pieceWidth || undefined
  });

  const displayedWidth = bgBox.width;
  const scale = displayedWidth / imgW;
  const trackScale = await getSliderTrackScaleFactor(btn, displayedWidth);

  // piece 初始 x 通常位于 bg 左侧（piece 元素 x 与 bg.left 的差）
  let pieceDisplayX = 0;
  const piece = await firstVisibleLocator(scope, PIECE_IMAGE_SELECTORS, 400);
  if (piece) {
    const pBox = await piece.boundingBox().catch(() => null);
    if (pBox) pieceDisplayX = pBox.x - bgBox.x;
  }

  const gapList =
    Array.isArray(candidates) && candidates.length > 0
      ? candidates.slice(0, 4)
      : [{ x: gapX, score: 0 }];

  const handleLeft0 = btnBox.x;

  for (let gi = 0; gi < gapList.length; gi += 1) {
    const gx = gapList[gi].x;
    const gapXDisplayed = gx * scale * trackScale;
    let baseDistance = Math.round(gapXDisplayed - pieceDisplayX);

    if (!Number.isFinite(baseDistance) || baseDistance <= 0) {
      baseDistance = Math.round(displayedWidth * 0.55);
    }

    // 仅对置信度最高的缺口做多档像素微调；其它候选各试一次以免拖太多次触发风控
    const fineDeltas =
      gi === 0 ? [0, -6, 6, -12, 12, -4, 4] : [0];

    console.log(
      `[${tag}] 滑块分析#${gi + 1}/${gapList.length}: bg显示宽=${Math.round(
        displayedWidth
      )}px, 图像宽=${imgW}, 候选缺口x(原图)=${gx}(分=${(
        gapList[gi].score || 0
      ).toFixed(0)}), 轨道/背景比≈${trackScale.toFixed(3)}, piece初始x=${Math.round(
        pieceDisplayX
      )}, 基础拖动≈${baseDistance}px`
    );

    for (let fi = 0; fi < fineDeltas.length; fi += 1) {
      const delta = fineDeltas[fi];
      const distance = Math.round(baseDistance + delta);
      if (distance < 8 || distance > displayedWidth * 1.25) continue;

      if (gi > 0 || fi > 0) {
        const back = await waitForSliderHandleReset(page, btn, handleLeft0);
        if (!back) {
          console.warn(
            `[${tag}] 等待滑块回位超时，跳过剩余尝试（可手动拖一次或刷新验证码）`
          );
          return false;
        }
      }

      const btnNow = await btn.boundingBox().catch(() => null);
      if (!btnNow) break;
      const startX = btnNow.x + btnNow.width / 2;
      const startY = btnNow.y + btnNow.height / 2;

      await humanDrag(page, {
        startX,
        startY,
        distance,
        durationMs: SLIDER_DRAG_DURATION_MS
      });

      await page.waitForTimeout(900);
      const passed = await waitForCaptchaDisappear(page, 2800);
      if (passed) {
        if (delta !== 0 || gi > 0) {
          console.log(
            `[${tag}] 滑块通过 ✓（候选#${gi + 1}${delta ? ` 微调${delta}px` : ""}）`
          );
        }
        return true;
      }
    }
  }

  return false;
}

/**
 * 在出现滑块时，重复尝试至多 maxRetry 次。
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {number} [options.maxRetry]   最大重试次数
 * @param {string} [options.tag]        日志 tag
 * @param {object} [options.paths]      调试图保存路径
 * @returns {Promise<boolean>} 是否最终通过
 */
async function solveCaptchaIfPresent(page, options = {}) {
  const { maxRetry = 5, tag = "shop", paths } = options;

  // 首先给滑块一点时间出现（通常在登录请求返回后）
  const appeared = await waitForCaptchaAppear(page, 2500);
  if (!appeared) {
    return true; // 没有验证码，视为通过
  }

  console.log(`[${tag}] 检测到滑块验证码，开始自动求解`);

  for (let i = 1; i <= maxRetry; i++) {
    console.log(`[${tag}] 第 ${i}/${maxRetry} 次尝试`);

    const ctx = await findCaptchaScope(page);
    if (!ctx) {
      console.log(`[${tag}] 滑块已消失，认为通过`);
      return true;
    }

    const ok = await solveOneSlider(page, ctx, { tag, paths });
    if (ok) {
      console.log(`[${tag}] 滑块通过 ✓`);
      return true;
    }

    console.log(`[${tag}] 本次未通过，刷新后重试`);
    const ctx2 = await findCaptchaScope(page);
    if (ctx2) {
      await refreshCaptcha(ctx2.scope).catch(() => {});
      await page.waitForTimeout(1200);
    } else {
      // 弹窗消失了，视为通过
      return true;
    }
  }

  console.warn(`[${tag}] 滑块多次失败，放弃自动求解`);
  return false;
}

module.exports = {
  findCaptchaScope,
  isCaptchaVisible,
  waitForCaptchaAppear,
  waitForCaptchaDisappear,
  solveCaptchaIfPresent
};
