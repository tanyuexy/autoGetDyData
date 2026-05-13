const { DOM_LOAD_TIMEOUT_MS } = require("./env");

const STAGES = Object.freeze({
  CAPTCHA: "CAPTCHA",
  LOGIN_FORM: "LOGIN_FORM",
  SHOP_PICKER: "SHOP_PICKER",
  COMPASS_VIDEO: "COMPASS_VIDEO",
  COMPASS_GRAPHIC: "COMPASS_GRAPHIC",
  COMPASS_OTHER: "COMPASS_OTHER",
  FXG_WORKSPACE: "FXG_WORKSPACE",
  UNKNOWN: "UNKNOWN"
});

const COMPASS_VIDEO_RE = /compass\.jinritemai\.com\/shop\/video\/self/;
const COMPASS_GRAPHIC_RE = /compass\.jinritemai\.com\/shop\/graphic\/graphic-analysis/;
const COMPASS_HOST_RE = /compass\.jinritemai\.com/;
const FXG_HOST_RE = /fxg\.jinritemai\.com/;
const LOGIN_URL_RE = /\/login\/(common|phone|email)|jinritemai\.com\/login\//;

const NETWORK_ERROR_PATTERNS = [
  "ERR_ABORTED",
  "ERR_TIMED_OUT",
  "ERR_NETWORK_CHANGED",
  "ERR_FAILED",
  "ERR_CONNECTION_CLOSED",
  "ERR_CONNECTION_REFUSED",
  "ERR_NAME_NOT_RESOLVED",
  "ERR_INTERNET_DISCONNECTED",
  "net::ERR_",
  "TimeoutError"
];

async function waitForDomLoaded(page, options = {}) {
  const tag = options.tag || "dom";
  const timeout = options.timeoutMs ?? DOM_LOAD_TIMEOUT_MS;
  try {
    await page.waitForLoadState("load", { timeout });
    return true;
  } catch (error) {
    const msg = error?.message || String(error);
    console.warn(`[${tag}] 等待 DOM load 超时（${timeout}ms），继续: ${msg}`);
    return false;
  }
}

async function isVisibleFast(locator, timeout = 250) {
  return locator.isVisible({ timeout }).catch(() => false);
}

async function hasCaptcha(page) {
  const cap = page.locator("#captcha_container").first();
  if (await isVisibleFast(cap, 200)) return true;
  const txt = page.locator("text=请完成下列验证后继续").first();
  return isVisibleFast(txt, 200);
}

async function hasShopPicker(page) {
  const title = page.locator("text=请选择店铺").first();
  if (await isVisibleFast(title, 500)) return true;
  const bodyHit = await page
    .evaluate(() => /请选择店铺|子账号/.test(document.body?.innerText || ""))
    .catch(() => false);
  if (bodyHit) return true;
  const roleList = page.locator('[class*="roleList"]').first();
  if (await isVisibleFast(roleList, 400)) return true;
  const roleItem = page.locator('[class*="roleItem"]').first();
  if (await isVisibleFast(roleItem, 400)) return true;
  const introName = page.locator('[class*="introName"]').first();
  return isVisibleFast(introName, 400);
}

async function hasLoginForm(page) {
  if (await hasShopPicker(page)) return false;

  const url = page.url() || "";

  // 邮箱登录 tab：有密码输入框 + 邮箱tab/邮箱输入框
  const pw = page.locator('input[type="password"]').first();
  const hasPasswordInput = await isVisibleFast(pw, 350);
  if (hasPasswordInput) {
    const emailTab = page
      .locator(
        'div[role="tab"]:has-text("邮箱登录"), span:has-text("邮箱登录"), :text-is("邮箱登录")'
      )
      .first();
    if (await isVisibleFast(emailTab, 280)) return true;

    const emailInput = page
      .locator(
        'input[placeholder="请输入邮箱"], input[placeholder*="邮箱"], input[type="email"]'
      )
      .first();
    if (await isVisibleFast(emailInput, 280)) return true;

    if (LOGIN_URL_RE.test(url)) return false;
    return false;
  }

  // 手机登录 tab（默认）：有手机号码输入框 + 手机登录tab
  const mobileInput = page.locator('input[placeholder="手机号码"]').first();
  const hasMobileInput = await isVisibleFast(mobileInput, 350);
  if (hasMobileInput) {
    const phoneTab = page
      .locator(
        'div[role="tab"]:has-text("手机登录"), span:has-text("手机登录"), :text-is("手机登录")'
      )
      .first();
    if (await isVisibleFast(phoneTab, 280)) return true;

    // 手机登录 tab 的另一种呈现方式（按钮式切换）
    const phoneTabBtn = page.locator('text=手机登录').first();
    if (await isVisibleFast(phoneTabBtn, 280)) return true;
  }

  if (LOGIN_URL_RE.test(url)) return false;

  return false;
}

async function hasFxgWorkspaceDom(page) {
  const userDrop = page
    .locator(
      'div[class*="userDropDown"].ecom-dropdown-trigger, div[class*="userDropDown"]'
    )
    .first();
  if (await isVisibleFast(userDrop, 300)) return true;
  for (const sel of [
    '[class*="shopName"]',
    '[class*="shopTitle"]',
    '[class*="ShopName"]'
  ]) {
    const el = page.locator(sel).first();
    if (await isVisibleFast(el, 250)) {
      const t = ((await el.textContent().catch(() => "")) || "").trim();
      if (t && !/^(登录|注册|请登录)/.test(t)) return true;
    }
  }
  return false;
}

async function detectStage(page) {
  const url = page.url() || "";

  if (await hasCaptcha(page)) return { stage: STAGES.CAPTCHA, url };
  if (await hasShopPicker(page)) return { stage: STAGES.SHOP_PICKER, url };
  if (await hasLoginForm(page)) return { stage: STAGES.LOGIN_FORM, url };

  if (COMPASS_VIDEO_RE.test(url)) return { stage: STAGES.COMPASS_VIDEO, url };
  if (COMPASS_GRAPHIC_RE.test(url)) return { stage: STAGES.COMPASS_GRAPHIC, url };
  if (COMPASS_HOST_RE.test(url)) return { stage: STAGES.COMPASS_OTHER, url };

  if (FXG_HOST_RE.test(url)) {
    if (await hasFxgWorkspaceDom(page)) {
      return { stage: STAGES.FXG_WORKSPACE, url };
    }
  }

  return { stage: STAGES.UNKNOWN, url };
}

function isAuthenticatedStage(stage) {
  return (
    stage === STAGES.SHOP_PICKER ||
    stage === STAGES.COMPASS_VIDEO ||
    stage === STAGES.COMPASS_GRAPHIC ||
    stage === STAGES.COMPASS_OTHER ||
    stage === STAGES.FXG_WORKSPACE
  );
}

async function waitForStage(page, targets, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const intervalMs = options.intervalMs ?? 350;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await detectStage(page);
    if (targets.includes(last.stage)) return last;
    await page.waitForTimeout(intervalMs);
  }
  return last || { stage: STAGES.UNKNOWN, url: page.url() || "" };
}

function isNetworkError(error) {
  const msg = error?.message ? String(error.message) : "";
  if (!msg) return false;
  return NETWORK_ERROR_PATTERNS.some((p) => msg.includes(p));
}

function backoffMs(base, attempt) {
  const factor = Math.min(attempt, 3) * 1.5;
  const jitter = Math.random() * 0.3 + 1;
  return Math.round(base * factor * jitter);
}

async function retryableGoto(page, url, opts = {}) {
  const maxRetries = opts.maxRetries ?? 2;
  const baseBackoff = opts.baseBackoff ?? 1200;
  const waitUntil = opts.waitUntil ?? "domcontentloaded";
  const timeout = opts.timeout ?? 20000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil, timeout });
      return true;
    } catch (error) {
      const netErr = isNetworkError(error);
      const isLast = attempt >= maxRetries;
      let curUrl = "";
      try {
        curUrl = page.url() || "";
      } catch {
        curUrl = "";
      }

      if (opts.expectedUrlRe && opts.expectedUrlRe.test(curUrl)) {
        console.warn(
          `[network] goto(${url.slice(0, 50)}) 抛错但 URL 已到达目标域(${curUrl.slice(0, 50)})，视为成功`
        );
        return true;
      }

      if (!netErr || isLast) {
        if (isLast && netErr) {
          console.error(
            `[network] goto(${url.slice(0, 50)}) 重试 ${maxRetries} 次后仍失败: ${error.message}`
          );
        }
        throw error;
      }

      const delay = backoffMs(baseBackoff, attempt);
      console.warn(
        `[network] goto(${url.slice(0, 50)}) 网络错误第 ${attempt + 1}/${maxRetries} 次重试，${delay}ms 后重试: ${error.message.slice(0, 100)}`
      );
      await page.waitForTimeout(delay).catch(() => {});
    }
  }
  return false;
}

async function retryableDownload(page, clickFn, opts = {}) {
  const timeout = opts.timeout ?? 60000;
  const maxRetries = opts.maxRetries ?? 1;
  const retryDelay = opts.retryDelay ?? 2000;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const dlPromise = page.waitForEvent("download", { timeout }).catch(() => null);
    try {
      await clickFn();
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      lastError = e;
      await page.waitForTimeout(retryDelay).catch(() => {});
      continue;
    }

    const dl = await dlPromise;
    if (dl) return dl;

    lastError = new Error(`waitForEvent("download") 在 ${timeout}ms 内未触发`);
    if (attempt >= maxRetries) throw lastError;

    console.warn(
      `[network] 下载未触发，第 ${attempt + 1}/${maxRetries} 次重试，${retryDelay}ms 后重试`
    );
    await page.waitForTimeout(retryDelay).catch(() => {});
  }
  throw lastError;
}

async function pickLatestSelectableCalendarDay(page, scopeRoot, dayOffset = 0) {
  const scope = scopeRoot || page;

  await page
    .locator(".ecom-picker-body")
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {});

  let remainingOffset = dayOffset;

  for (let monthHop = 0; monthHop < 6; monthHop++) {
    const yearMonth = await readCalendarYearMonth(scope);

    const inViewCells = scope.locator(
      "td.ecom-picker-cell.ecom-picker-cell-in-view:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
    );
    let count = await inViewCells.count().catch(() => 0);

    if (count === 0) {
      const anyCells = scope.locator(
        "td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
      );
      count = await anyCells.count().catch(() => 0);
    }

    if (count > 0 && count - 1 >= remainingOffset) {
      const idx = count - 1 - remainingOffset;
      const target = await pickCalendarTarget(scope, inViewCells, idx);
      const dayStr = (await target.innerText().catch(() => "")).trim();
      const day = parseInt(dayStr, 10);
      await target.click({ timeout: 2000 }).catch(() => {});
      return { ok: true, dataDate: formatCalendarDate(yearMonth, day) };
    }

    remainingOffset = Math.max(0, remainingOffset - Math.max(count, 1));

    const prevClicked = await clickPrevMonthBtn(scope);
    if (!prevClicked) {
      if (count > 0) {
        const idx = count - 1;
        const target = await pickCalendarTarget(scope, inViewCells, idx);
        const dayStr = (await target.innerText().catch(() => "")).trim();
        const day = parseInt(dayStr, 10);
        await target.click({ timeout: 2000 }).catch(() => {});
        return { ok: true, dataDate: formatCalendarDate(yearMonth, day) };
      }
      return { ok: false, dataDate: null };
    }

    await page.waitForTimeout(300);
  }

  return { ok: false, dataDate: null };
}

async function pickCalendarTarget(scope, inViewCells, idx) {
  if (inViewCells && (await inViewCells.count().catch(() => 0)) > 0) {
    return inViewCells.nth(idx);
  }
  const anyCells = scope.locator(
    "td.ecom-picker-cell:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner"
  );
  return anyCells.nth(idx);
}

function formatCalendarDate(yearMonth, day) {
  if (!yearMonth || !Number.isFinite(day) || day < 1 || day > 31) return null;
  const { y, mo } = yearMonth;
  return `${y}/${String(mo).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

async function clickPrevMonthBtn(scope) {
  const prevSelectors = [
    ".ecom-picker-header-prev-btn",
    ".ecom-picker-super-prev-btn",
    "button.ecom-picker-header-btn:first-of-type",
    ".ecom-picker-header button:first-of-type",
    '[class*="prev"]',
    ".ecom-picker-header button svg"
  ];

  for (const sel of prevSelectors) {
    const btn = scope.locator(sel).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click({ timeout: 2000 }).catch(() => {});
      return true;
    }
  }

  const headerBtns = scope.locator(".ecom-picker-header button");
  const btnCount = await headerBtns.count().catch(() => 0);
  if (btnCount >= 2) {
    await headerBtns.nth(0).click({ timeout: 2000 }).catch(() => {});
    return true;
  }

  return false;
}

async function readCalendarYearMonth(scope) {
  const header = scope.locator(".ecom-picker-header").first();
  const text = (await header.innerText().catch(() => "")).trim();
  const compact = text.replace(/\s+/g, " ");
  let m = compact.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (m) return { y: +m[1], mo: +m[2] };
  m = compact.match(/(\d{4})\s*[年.\/-]\s*(\d{1,2})/);
  if (m) return { y: +m[1], mo: +m[2] };
  return null;
}

module.exports = {
  STAGES,
  detectStage,
  hasShopPicker,
  isAuthenticatedStage,
  waitForStage,
  waitForDomLoaded,
  isNetworkError,
  retryableGoto,
  retryableDownload,
  pickLatestSelectableCalendarDay,
  readCalendarYearMonth
};
