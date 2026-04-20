/**
 * 统一的「当前页面阶段」检测器。
 *
 * 目的：抖店/罗盘是 SPA，URL 变化与 DOM 变化并不同步；
 * 过去每一步都靠上一步的线性假设推进，导致「已到选店页还在填密码」「cookie 直连后
 * 还在等登录表单」等错配。这里把全流程切成互斥阶段 + 专门的识别特征，
 * 关键步骤前统一用 detectStage() 拿到「当前真实阶段」再决定路径。
 *
 * 阶段代号：
 *  - CAPTCHA           滑块/验证层（优先级最高，可能叠加在任意页）
 *  - LOGIN_FORM        抖店登录表单
 *  - SHOP_PICKER       "请选择店铺" 选店页
 *  - COMPASS_VIDEO     罗盘 - 短视频自营明细
 *  - COMPASS_GRAPHIC   罗盘 - 图文分析
 *  - COMPASS_OTHER     罗盘 - 其它页面（如 homepage）
 *  - FXG_WORKSPACE     抖店工作台（fxg，已登录但不在罗盘）
 *  - UNKNOWN           其它
 */

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

async function isVisibleFast(locator, timeout = 250) {
  return locator.isVisible({ timeout }).catch(() => false);
}

async function hasCaptcha(page) {
  const cap = page.locator("#captcha_container").first();
  if (await isVisibleFast(cap, 200)) return true;
  const txt = page.locator("text=请完成下列验证后继续").first();
  return isVisibleFast(txt, 200);
}

/**
 * 真正的登录表单：须能看到密码框 +（邮箱入口或邮箱输入框）。
 * 注意：选店页「请选择店铺」常与 /login/common 共用 URL，绝不能仅凭路径判为登录态。
 */
async function hasLoginForm(page) {
  if (await hasShopPicker(page)) return false;

  const pw = page.locator('input[type="password"]').first();
  if (!(await isVisibleFast(pw, 350))) return false;

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

  // 仍在 login 路径但邮箱区未渲染（或只剩手机号 tab）：不算可填的邮箱登录表单
  const url = page.url() || "";
  if (LOGIN_URL_RE.test(url)) return false;

  return false;
}

async function hasShopPicker(page) {
  const title = page.locator("text=请选择店铺").first();
  if (await isVisibleFast(title, 500)) return true;
  const roleList = page.locator('[class*="roleList"]').first();
  if (await isVisibleFast(roleList, 400)) return true;
  const roleItem = page.locator('[class*="roleItem"]').first();
  return isVisibleFast(roleItem, 400);
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

/**
 * 识别当前阶段。同一时刻只返回一个阶段，按业务优先级裁决。
 * 选店页优先于登录表单（二者可能共处于 /login/common URL）。
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{stage: string, url: string}>}
 */
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

/**
 * 判断阶段是否「已登录」——可以跳过账号密码流程。
 */
function isAuthenticatedStage(stage) {
  return (
    stage === STAGES.SHOP_PICKER ||
    stage === STAGES.COMPASS_VIDEO ||
    stage === STAGES.COMPASS_GRAPHIC ||
    stage === STAGES.COMPASS_OTHER ||
    stage === STAGES.FXG_WORKSPACE
  );
}

/**
 * 轮询等待直到当前阶段进入给定集合之一（命中即返回，不命中继续轮询）。
 * 常用于点击登录后、点击滑块后、选店点击后等「预期跳到 A 或 B」的断点。
 *
 * @param {import('playwright').Page} page
 * @param {string[]} targets
 * @param {{ timeoutMs?: number, intervalMs?: number }} [options]
 */
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

module.exports = {
  STAGES,
  detectStage,
  hasShopPicker,
  isAuthenticatedStage,
  waitForStage
};
