const path = require("path");
const fs = require("fs/promises");

const {
  SHOP_LOGIN_URL,
  SHOP_HOME_URL,
  ACCOUNTS_DIR,
  LOGIN_TIMEOUT_MS,
  SLIDER_MAX_RETRY
} = require("./env");
const { solveCaptchaIfPresent } = require("./captcha");
const {
  isShopPickerVisible
} = require("./shop-picker");
const { runPostLoginFlow } = require("./post-login-flow");
const {
  STAGES,
  detectStage,
  isAuthenticatedStage,
  retryableGoto
} = require("./page-utils");

const PAGE_ACTIVITY_TRACKERS = new WeakMap();
const LOGIN_STAGE_TIMEOUT_MS = Number(process.env.SHOP_LOGIN_STAGE_TIMEOUT_MS || 12000);
const LOGIN_STAGE_MAX_WAIT_MS = Number(
  process.env.SHOP_LOGIN_STAGE_MAX_WAIT_MS || Math.max(LOGIN_TIMEOUT_MS, 5 * 60 * 1000)
);
const LOGIN_FORM_FIELDS_TIMEOUT_MS = Number(
  process.env.SHOP_LOGIN_FORM_FIELDS_TIMEOUT_MS || 20000
);
const LOGIN_NETWORK_IDLE_GRACE_MS = Number(
  process.env.SHOP_LOGIN_NETWORK_IDLE_GRACE_MS || 12000
);

function getPageActivityTracker(page) {
  const existing = PAGE_ACTIVITY_TRACKERS.get(page);
  if (existing) return existing;

  const tracker = {
    inflight: 0,
    lastActivityAt: Date.now(),
  };
  const markActivity = () => {
    tracker.lastActivityAt = Date.now();
  };
  const onRequest = () => {
    tracker.inflight += 1;
    markActivity();
  };
  const onRequestDone = () => {
    tracker.inflight = Math.max(0, tracker.inflight - 1);
    markActivity();
  };
  const onDomEvent = () => {
    markActivity();
  };

  page.on("request", onRequest);
  page.on("requestfinished", onRequestDone);
  page.on("requestfailed", onRequestDone);
  page.on("response", onDomEvent);
  page.on("domcontentloaded", onDomEvent);
  page.on("load", onDomEvent);
  page.on("framenavigated", onDomEvent);

  PAGE_ACTIVITY_TRACKERS.set(page, tracker);
  return tracker;
}

function getPageActivitySnapshot(page) {
  const tracker = getPageActivityTracker(page);
  return {
    inflight: tracker.inflight,
    idleMs: Date.now() - tracker.lastActivityAt,
  };
}

function isPageStillActive(page, idleGraceMs = LOGIN_NETWORK_IDLE_GRACE_MS) {
  const snapshot = getPageActivitySnapshot(page);
  return snapshot.inflight > 0 || snapshot.idleMs < idleGraceMs;
}

async function waitForStageWithActivity(page, targets, options = {}) {
  const timeoutMs = options.timeoutMs ?? LOGIN_STAGE_TIMEOUT_MS;
  const maxWaitMs = options.maxWaitMs ?? Math.max(timeoutMs, LOGIN_STAGE_MAX_WAIT_MS);
  const intervalMs = options.intervalMs ?? 350;
  const idleGraceMs = options.idleGraceMs ?? LOGIN_NETWORK_IDLE_GRACE_MS;
  const tag = options.tag || "login";
  const softDeadline = Date.now() + timeoutMs;
  const hardDeadline = Date.now() + maxWaitMs;
  let last = null;
  let extendedLogged = false;

  while (Date.now() < hardDeadline) {
    last = await detectStage(page);
    if (targets.includes(last.stage)) return last;

    if (Date.now() >= softDeadline) {
      const snapshot = getPageActivitySnapshot(page);
      if (snapshot.inflight <= 0 && snapshot.idleMs >= idleGraceMs) break;
      if (!extendedLogged) {
        console.log(
          `[${tag}] 阶段等待超过 ${timeoutMs}ms，但页面仍有活动（inflight=${snapshot.inflight}, idle=${snapshot.idleMs}ms），继续等待`
        );
        extendedLogged = true;
      }
    }

    await page.waitForTimeout(intervalMs);
  }

  return last || { stage: STAGES.UNKNOWN, url: page.url() || "" };
}

async function waitForLoginFormFields(page, tag, options = {}) {
  const timeoutMs = options.timeoutMs ?? LOGIN_FORM_FIELDS_TIMEOUT_MS;
  const maxWaitMs = options.maxWaitMs ?? Math.max(timeoutMs, LOGIN_STAGE_MAX_WAIT_MS);
  const intervalMs = options.intervalMs ?? 300;
  const idleGraceMs = options.idleGraceMs ?? LOGIN_NETWORK_IDLE_GRACE_MS;
  const softDeadline = Date.now() + timeoutMs;
  const hardDeadline = Date.now() + maxWaitMs;
  let extendedLogged = false;

  const emailInput = page
    .locator(
      'input[placeholder="请输入邮箱"], input[placeholder*="邮箱"], input[type="email"]'
    )
    .first();
  const passwordInput = page
    .locator('input[type="password"], input[placeholder="密码"]')
    .first();

  while (Date.now() < hardDeadline) {
    const currentStage = await detectStage(page);
    if (isAuthenticatedStage(currentStage.stage)) {
      return { authenticatedStage: currentStage };
    }

    const emailVisible = await emailInput.isVisible({ timeout: 250 }).catch(() => false);
    const passwordVisible = await passwordInput.isVisible({ timeout: 250 }).catch(() => false);
    if (emailVisible && passwordVisible) {
      return { emailInput, passwordInput };
    }

    if (Date.now() >= softDeadline) {
      const snapshot = getPageActivitySnapshot(page);
      if (snapshot.inflight <= 0 && snapshot.idleMs >= idleGraceMs) {
        const stage = await detectStage(page);
        throw new Error(
          `登录表单未出现：stage=${stage.stage}，等待 ${timeoutMs}ms 后页面空闲（idle=${snapshot.idleMs}ms）`
        );
      }
      if (!extendedLogged) {
        console.log(
          `[${tag}] 登录表单字段等待超过 ${timeoutMs}ms，但页面仍有活动（inflight=${snapshot.inflight}, idle=${snapshot.idleMs}ms），继续等待`
        );
        extendedLogged = true;
      }
    }

    await page.waitForTimeout(intervalMs);
  }

  const stage = await detectStage(page);
  const snapshot = getPageActivitySnapshot(page);
  throw new Error(
    `登录表单未出现：stage=${stage.stage}，已达最大等待 ${maxWaitMs}ms（inflight=${snapshot.inflight}, idle=${snapshot.idleMs}ms）`
  );
}

async function waitBrieflyForAuthenticatedStage(page, tag, reason) {
  const stage = await waitForStageWithActivity(
    page,
    [
      STAGES.SHOP_PICKER,
      STAGES.COMPASS_VIDEO,
      STAGES.COMPASS_GRAPHIC,
      STAGES.COMPASS_OTHER,
      STAGES.FXG_WORKSPACE
    ],
    { timeoutMs: 2500, maxWaitMs: 8000, intervalMs: 250, tag }
  );
  if (isAuthenticatedStage(stage.stage)) {
    console.log(`[${tag}] ${reason}发现已登录 (stage=${stage.stage})，跳过账号密码流程`);
    return stage;
  }
  return null;
}

function getAccountPaths(email) {
  const safeName = String(email).replace(/[\\/:*?"<>|]+/g, "_");
  const accountDir = path.join(ACCOUNTS_DIR, safeName);
  return {
    email,
    accountDir,
    storageStatePath: path.join(accountDir, "storageState.json"),
    cookiesPath: path.join(accountDir, "cookies.json"),
    debugDir: path.join(accountDir, "debug"),
    dataDir: path.join(accountDir, "data")
  };
}

async function ensureAccountPaths(paths) {
  await fs.mkdir(paths.accountDir, { recursive: true });
  await fs.mkdir(paths.debugDir, { recursive: true });
  await fs.mkdir(paths.dataDir, { recursive: true });
}

/**
 * 切换到"邮箱登录" tab。页面加载后可能默认是手机号登录，必须显式点击。
 * 切完后必须等到"邮箱输入框"和"密码输入框"同时可见，否则下一步会把两个值写到同一个框里。
 */
async function switchToEmailTab(page) {
  const beforeStage = await detectStage(page);
  if (isAuthenticatedStage(beforeStage.stage)) {
    return { authenticatedStage: beforeStage };
  }

  const tabLoc = page
    .locator(
      'div[role="tab"]:has-text("邮箱登录"), span:has-text("邮箱登录"), :text-is("邮箱登录")'
    )
    .first();
  if (await tabLoc.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tabLoc.click({ timeout: 2000 }).catch(() => {});
  }

  const afterClickStage = await detectStage(page);
  if (isAuthenticatedStage(afterClickStage.stage)) {
    return { authenticatedStage: afterClickStage };
  }

  // 关键：必须等密码输入框也已渲染，否则 fillCredentials 会把密码写进邮箱框
  await page
    .locator('input[type="password"]')
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .catch(() => {});

  const afterWaitStage = await detectStage(page);
  if (isAuthenticatedStage(afterWaitStage.stage)) {
    return { authenticatedStage: afterWaitStage };
  }

  return { authenticatedStage: null };
}

/**
 * 清空一个 input 再写入目标值。
 * 用 triple-click 全选 + 填空，兼容带受控清除按钮的 React 组件。
 */
async function clearAndFill(input, value) {
  await input.click({ clickCount: 3 }).catch(() => {});
  await input.fill("").catch(() => {});
  await input.fill(value);
}

/**
 * 填写邮箱 + 密码；填完回读校验，发现串行写入到同一框就清空重填。
 */
async function fillCredentials(page, email, password) {
  const { emailInput, passwordInput, authenticatedStage } = await waitForLoginFormFields(page, email);
  if (authenticatedStage) {
    return { authenticatedStage };
  }

  // 先把焦点打到 email 上一次性写入（不在填写中途切换焦点）
  await clearAndFill(emailInput, email);

  // 切焦点到 password；triple-click 会把焦点确切落在目标 input
  await clearAndFill(passwordInput, password);

  // 让 React 完成 setState 与表单校验
  await page.waitForTimeout(150);

  // 回读校验：邮箱字段里不能混进密码；密码字段长度必须匹配
  const emailVal = await emailInput.inputValue().catch(() => "");
  const pwVal = await passwordInput.inputValue().catch(() => "");

  const needRefillEmail = emailVal !== email;
  const needRefillPassword = pwVal.length !== password.length;

  if (needRefillEmail || needRefillPassword) {
    console.warn(
      `填写校验失败 → 邮箱期望"${email}"实际"${emailVal}"；密码长度期望 ${password.length} 实际 ${pwVal.length}，执行一次重填。`
    );
    if (needRefillEmail) await clearAndFill(emailInput, email);
    if (needRefillPassword) await clearAndFill(passwordInput, password);
    await page.waitForTimeout(150);

    const emailVal2 = await emailInput.inputValue().catch(() => "");
    const pwVal2 = await passwordInput.inputValue().catch(() => "");
    if (emailVal2 !== email || pwVal2.length !== password.length) {
      throw new Error(
        `邮箱/密码填写异常：邮箱="${emailVal2}"，密码长度=${pwVal2.length}（期望 ${password.length}）`
      );
    }
  }
  return { authenticatedStage: null };
}

/**
 * 勾选"同意用户协议"checkbox。
 * 页面上的 <input type="checkbox"> 是 readonly 的，直接 click 无效，
 * 需要点击它的 wrapper（label / .semi-checkbox / 父元素）。
 */
async function ensureAgreementChecked(page) {
  const result = await page
    .evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll('input[type="checkbox"]')
      );
      let clicked = 0;
      for (const input of inputs) {
        if (!input.checked) {
          const wrap =
            input.closest("label") ||
            input.closest('[class*="checkbox"]') ||
            input.parentElement;
          (wrap || input).click();
          clicked += 1;
        }
      }
      return { total: inputs.length, clicked };
    })
    .catch(() => ({ total: 0, clicked: 0 }));
  await page.waitForTimeout(120);
  return result;
}

/**
 * 点击“登录”按钮。
 * 关键点：
 * 1) 用 :not([disabled]) 精确等待按钮变为 enabled（协议勾选 + 表单通过后才会 enabled）；
 * 2) noWaitAfter 避免点击后还去轮询"stable"，防止 captcha 弹出后卡死 30 秒；
 * 3) 如果 click 真抛错了，但 captcha 已出现，视为点击生效直接返回。
 */
async function clickLogin(page) {
  if (
    await page
      .locator("#captcha_container, text=请完成下列验证后继续")
      .first()
      .isVisible({ timeout: 200 })
      .catch(() => false)
  ) {
    return;
  }

  const enabledBtn = page
    .locator('button:not([disabled])', { hasText: "登录" })
    .first();

  try {
    await enabledBtn.waitFor({ state: "visible", timeout: 6000 });
    await enabledBtn.click({ timeout: 2500, noWaitAfter: true });
  } catch (error) {
    const captchaShown = await page
      .locator("#captcha_container, text=请完成下列验证后继续")
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
    if (captchaShown) return;
    // 兜底：强制点，让事件一定派发
    await page
      .locator('button', { hasText: "登录" })
      .first()
      .click({ force: true, timeout: 1500, noWaitAfter: true })
      .catch(() => {});
  }
}

/**
 * 是否出现抖店/罗盘「登录」相关 UI（会话失效时常驻留在工作台 URL 但表单已弹出）。
 * 命中则视为未登录，避免仅靠 URL 误判。
 * 选店页 URL 常为 /login/common，必须与真实登录弹层区分。
 */
async function hasLoginUi(page) {
  if (await isShopPickerVisible(page)) return false;

  const url = page.url() || "";
  const pw = page.locator('input[type="password"]').first();
  const pwOk = await pw.isVisible({ timeout: 280 }).catch(() => false);

  const emailLike = page
    .locator(
      'input[placeholder="请输入邮箱"], input[placeholder*="邮箱"], input[type="email"]'
    )
    .first();
  const emailLikeOk = await emailLike
    .isVisible({ timeout: 280 })
    .catch(() => false);

  const emailTab = page
    .locator(
      'div[role="tab"]:has-text("邮箱登录"), span:has-text("邮箱登录"), :text-is("邮箱登录")'
    )
    .first();
  const emailTabOk = await emailTab
    .isVisible({ timeout: 280 })
    .catch(() => false);

  const phoneTabOk = await page
    .locator("text=手机号登录")
    .first()
    .isVisible({ timeout: 280 })
    .catch(() => false);

  const hasCredentialUi = emailLikeOk || emailTabOk || phoneTabOk;

  if (url.includes("/login/")) {
    return Boolean(pwOk && hasCredentialUi);
  }

  if (!pwOk) return false;
  return hasCredentialUi;
}

/**
 * 工作台已登录后的 DOM 特征（与 shop-switch 中实地结构一致），用于 cookie 复用探测。
 */
async function hasAuthenticatedWorkspaceDom(page) {
  if (await isShopPickerVisible(page)) return true;

  const userDrop = page
    .locator(
      'div[class*="userDropDown"].ecom-dropdown-trigger, div[class*="userDropDown"]'
    )
    .first();
  if (await userDrop.isVisible({ timeout: 650 }).catch(() => false)) return true;

  for (const sel of [
    '[class*="shopName"]',
    '[class*="shopTitle"]',
    '[class*="ShopName"]'
  ]) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 450 }).catch(() => false)) {
      const t = ((await el.textContent().catch(() => "")) || "").trim();
      if (t && !/^(登录|注册|请登录)/.test(t)) return true;
    }
  }

  return false;
}

/**
 * 判断是否已经登录到抖店后台。
 * 必须先排除登录页/登录表单，再要求选店页或工作台 DOM，避免「探测 URL 即 /ffa/mshop」时瞬间误判。
 */
async function isLoggedIn(page) {
  if (await isShopPickerVisible(page)) return true;

  if (await hasLoginUi(page)) return false;

  const url = page.url() || "";
  if (
    url.includes("/login/common") ||
    url.includes("/login/phone") ||
    url.includes("/login/email") ||
    (url.includes("jinritemai.com") && url.includes("/login/"))
  ) {
    return false;
  }

  if (url.includes("fxg.jinritemai.com") || url.includes("compass.jinritemai.com")) {
    return hasAuthenticatedWorkspaceDom(page);
  }

  return false;
}

async function waitForLoginSettled(page, timeoutMs = 15000) {
  const softDeadline = Date.now() + timeoutMs;
  const hardDeadline = Date.now() + Math.max(timeoutMs, LOGIN_STAGE_MAX_WAIT_MS);
  let extendedLogged = false;

  while (Date.now() < hardDeadline) {
    if (await isShopPickerVisible(page)) return true;
    if (await isLoggedIn(page)) return true;

    if (Date.now() >= softDeadline) {
      const snapshot = getPageActivitySnapshot(page);
      if (snapshot.inflight <= 0 && snapshot.idleMs >= LOGIN_NETWORK_IDLE_GRACE_MS) {
        return false;
      }
      if (!extendedLogged) {
        console.log(
          `[login] 登录落地等待超过 ${timeoutMs}ms，但页面仍有活动（inflight=${snapshot.inflight}, idle=${snapshot.idleMs}ms），继续等待`
        );
        extendedLogged = true;
      }
    }

    await page.waitForTimeout(400);
  }
  return false;
}

async function saveStorageState(context, paths) {
  await context.storageState({ path: paths.storageStatePath });
  try {
    const state = JSON.parse(
      await fs.readFile(paths.storageStatePath, "utf-8")
    );
    await fs.writeFile(
      paths.cookiesPath,
      JSON.stringify(state.cookies || [], null, 2),
      "utf-8"
    );
  } catch {
    // 忽略
  }
  // 登录成功后写入浏览器验证快照，使 /api/shop/list 的静态分析能合并到此结果
  try {
    const vp = path.join(paths.accountDir, "verified-at.json");
    const fsSync = require("fs");
    fsSync.writeFileSync(
      vp,
      JSON.stringify({
        time: Date.now(),
        detail: "登录流程中验证通过",
        verified: true,
        status: "valid",
      }),
      "utf-8"
    );
  } catch {
    // 忽略
  }
}

/**
 * 用已缓存的 cookie/storageState 直连工作台，尝试"免密登录"。
 * 返回 true 表示 cookie 仍然有效，可以直接进入后续流程；false 表示需要走账号密码登录。
 */
async function tryReuseCookieLogin(page, tag) {
  getPageActivityTracker(page);
  const hasCookies = await page.context().cookies().then((cs) => cs.length > 0).catch(() => false);
  if (!hasCookies) return false;

  const probeUrl = SHOP_HOME_URL || SHOP_LOGIN_URL;
  console.log(`[${tag}] 检测到已有 cookie，尝试直连 ${probeUrl}`);
  try {
    await retryableGoto(page, probeUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
      maxRetries: 2,
      baseBackoff: 2500,
      expectedUrlRe: /jinritemai\.com/
    });
  } catch (error) {
    console.warn(`[${tag}] 直连工作台失败: ${error.message || error}`);
    return false;
  }

  // 给 SPA 一点时间决定跳转与渲染（失效时可能先停在 home URL 再出登录表单）
  const settled = await waitForStageWithActivity(
    page,
    [
      STAGES.LOGIN_FORM,
      STAGES.SHOP_PICKER,
      STAGES.COMPASS_VIDEO,
      STAGES.COMPASS_GRAPHIC,
      STAGES.COMPASS_OTHER,
      STAGES.FXG_WORKSPACE,
      STAGES.CAPTCHA
    ],
    { timeoutMs: 10000, maxWaitMs: 90000, intervalMs: 320, tag }
  );
  console.log(`[${tag}] cookie 直连后阶段=${settled.stage} url=${settled.url}`);
  return isAuthenticatedStage(settled.stage);
}

/**
 * 执行一次完整的抖店邮箱登录流程。
 *
 * @param {import('playwright').BrowserContext} context
 * @param {{ email: string, password: string }} account
 */
async function runShopLogin(context, account, options = {}) {
  const { email, password } = account;
  const paths = getAccountPaths(email);
  await ensureAccountPaths(paths);

  const processedNames =
    options.processedNames instanceof Set
      ? options.processedNames
      : new Set(options.processedNames || []);
  const daysToExport = options.daysToExport || 1;
  const exportBatchId = options.exportBatchId || null;
  const accountEmail = options.accountEmail || email;
  const selectedShopNames = Array.isArray(options.selectedShopNames)
    ? options.selectedShopNames.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  const postLoginOptions = { processedNames, daysToExport, exportBatchId, accountEmail, selectedShopNames };

  const page = await context.newPage();
  const tag = email;
  getPageActivityTracker(page);

  try {
    const t0 = Date.now();

    // 优先走 cookie 复用：如果账号目录下已有 storageState，直接探测工作台。
    // cookie 有效就跳过整个登录流程；无效再回落到账号密码登录。
    if (await tryReuseCookieLogin(page, tag)) {
      console.log(`[${tag}] cookie 仍然有效，跳过账号密码登录`);
      await saveStorageState(context, paths);
      if (!options.loginOnly) {
        const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
        return { ok: true, reused: true, paths, ...extra };
      }
      console.log(`[${tag}] 纯登录模式，跳过后续流程`);
      return { ok: true, reused: true, paths };
    }

    console.log(`[${tag}] 打开抖店登录页 ${SHOP_LOGIN_URL}`);
    await retryableGoto(page, SHOP_LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
      maxRetries: 2,
      baseBackoff: 2500,
      expectedUrlRe: /jinritemai\.com\/login/
    });
    // 抖店页面长连接/埋点会让 networkidle 几乎永远触发不到，
    // 等到「登录表单 / 选店页 / 工作台 / 滑块」任一阶段出现即可。
    const preFormStage = await waitForStageWithActivity(
      page,
      [
        STAGES.LOGIN_FORM,
        STAGES.SHOP_PICKER,
        STAGES.COMPASS_VIDEO,
        STAGES.COMPASS_GRAPHIC,
        STAGES.COMPASS_OTHER,
        STAGES.FXG_WORKSPACE,
        STAGES.CAPTCHA
      ],
      { timeoutMs: 12000, maxWaitMs: 120000, intervalMs: 350, tag }
    );
    console.log(
      `[${tag}] 登录页阶段识别: stage=${preFormStage.stage} url=${preFormStage.url}`
    );

    // 快速通道：cookie/登录态直接有效（探测 URL 没跳登录页或已在选店/工作台）
    if (isAuthenticatedStage(preFormStage.stage)) {
      console.log(
        `[${tag}] 当前已处于登录态（阶段=${preFormStage.stage}），跳过账号密码流程`
      );
      await saveStorageState(context, paths);
      if (!options.loginOnly) {
        const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
        return { ok: true, reused: true, paths, ...extra };
      }
      console.log(`[${tag}] 纯登录模式，跳过后续流程`);
      return { ok: true, reused: true, paths };
    }

    // 只有在「真的处于登录表单」时才执行 tab 切换/填密码；其它阶段全部按异常走兜底路径
    if (preFormStage.stage !== STAGES.LOGIN_FORM && preFormStage.stage !== STAGES.CAPTCHA) {
      console.warn(
        `[${tag}] 登录页阶段非预期 (${preFormStage.stage})，仍尝试按登录表单流程走一次`
      );
    }

    if (preFormStage.stage === STAGES.LOGIN_FORM) {
      const authenticatedStage = await waitBrieflyForAuthenticatedStage(
        page,
        tag,
        "登录表单出现后等待页面跳转时"
      );
      if (authenticatedStage) {
        await saveStorageState(context, paths);
        if (!options.loginOnly) {
          const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
          return { ok: true, reused: true, paths, ...extra };
        }
        console.log(`[${tag}] 纯登录模式，跳过后续流程`);
        return { ok: true, reused: true, paths };
      }
    }

    // === Gate: 准备填表前再确认一次阶段 ===
    const beforeFillStage = (await detectStage(page)).stage;
    if (isAuthenticatedStage(beforeFillStage)) {
      console.log(
        `[${tag}] 填表前发现已登录 (stage=${beforeFillStage})，跳过填表/点击登录`
      );
      await saveStorageState(context, paths);
      if (!options.loginOnly) {
        const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
        return { ok: true, reused: true, paths, ...extra };
      }
      console.log(`[${tag}] 纯登录模式，跳过后续流程`);
      return { ok: true, reused: true, paths };
    }

    if (beforeFillStage === STAGES.LOGIN_FORM) {
      console.log(`[${tag}] 切换到邮箱登录 tab`);
      const switchResult = await switchToEmailTab(page);
      if (switchResult.authenticatedStage) {
        console.log(
          `[${tag}] 切换邮箱登录前后发现已登录 (stage=${switchResult.authenticatedStage.stage})，跳过填表/点击登录`
        );
        await saveStorageState(context, paths);
        if (!options.loginOnly) {
          const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
          return { ok: true, reused: true, paths, ...extra };
        }
        console.log(`[${tag}] 纯登录模式，跳过后续流程`);
        return { ok: true, reused: true, paths };
      }

      console.log(`[${tag}] 填写邮箱与密码`);
      const fillResult = await fillCredentials(page, email, password);
      if (fillResult.authenticatedStage) {
        console.log(
          `[${tag}] 填写邮箱密码前发现已登录 (stage=${fillResult.authenticatedStage.stage})，跳过点击登录`
        );
        await saveStorageState(context, paths);
        if (!options.loginOnly) {
          const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
          return { ok: true, reused: true, paths, ...extra };
        }
        console.log(`[${tag}] 纯登录模式，跳过后续流程`);
        return { ok: true, reused: true, paths };
      }
      await ensureAgreementChecked(page);
    } else if (beforeFillStage === STAGES.CAPTCHA) {
      console.log(`[${tag}] 进入页面即遇滑块，直接跳到滑块处理阶段`);
    } else {
      console.warn(
        `[${tag}] 未能识别为登录表单阶段 (${beforeFillStage})，仍按标准流程执行一次填表`
      );
      const switchResult = await switchToEmailTab(page);
      if (switchResult.authenticatedStage) {
        console.log(
          `[${tag}] 切换邮箱登录前后发现已登录 (stage=${switchResult.authenticatedStage.stage})，跳过填表/点击登录`
        );
        await saveStorageState(context, paths);
        if (!options.loginOnly) {
          const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
          return { ok: true, reused: true, paths, ...extra };
        }
        console.log(`[${tag}] 纯登录模式，跳过后续流程`);
        return { ok: true, reused: true, paths };
      }
      const fillResult = await fillCredentials(page, email, password);
      if (fillResult.authenticatedStage) {
        console.log(
          `[${tag}] 填写邮箱密码前发现已登录 (stage=${fillResult.authenticatedStage.stage})，跳过点击登录`
        );
        await saveStorageState(context, paths);
        if (!options.loginOnly) {
          const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
          return { ok: true, reused: true, paths, ...extra };
        }
        console.log(`[${tag}] 纯登录模式，跳过后续流程`);
        return { ok: true, reused: true, paths };
      }
      await ensureAgreementChecked(page);
    }

    // === Gate: 点击登录按钮之前再确认一次 ===
    const beforeClickStage = (await detectStage(page)).stage;
    if (isAuthenticatedStage(beforeClickStage)) {
      console.log(
        `[${tag}] 点登录前发现已登录 (stage=${beforeClickStage})，跳过点击`
      );
      await saveStorageState(context, paths);
      if (!options.loginOnly) {
        const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
        return { ok: true, reused: true, paths, ...extra };
      }
      console.log(`[${tag}] 纯登录模式，跳过后续流程`);
      return { ok: true, reused: true, paths };
    }

    if (beforeClickStage === STAGES.LOGIN_FORM) {
      console.log(
        `[${tag}] 表单就绪，耗时 ${Date.now() - t0}ms，点击登录按钮`
      );
      await clickLogin(page);
    } else if (beforeClickStage === STAGES.CAPTCHA) {
      console.log(`[${tag}] 已直接出现滑块，跳过点击登录`);
    } else {
      console.warn(
        `[${tag}] 点登录前阶段异常 (${beforeClickStage})，仍尝试一次点击`
      );
      await clickLogin(page);
    }

    // 点击后：预期进入「滑块 / 选店 / 罗盘 / 工作台」任一阶段
    console.log(`[${tag}] 检查点击登录后的页面阶段`);
    const afterClickStage = await waitForStageWithActivity(
      page,
      [
        STAGES.CAPTCHA,
        STAGES.SHOP_PICKER,
        STAGES.COMPASS_VIDEO,
        STAGES.COMPASS_GRAPHIC,
        STAGES.COMPASS_OTHER,
        STAGES.FXG_WORKSPACE
      ],
      { timeoutMs: 3500, maxWaitMs: 90000, intervalMs: 180, tag }
    );
    console.log(`[${tag}] 点击后阶段: ${afterClickStage.stage}`);

    let passed = true;
    if (isAuthenticatedStage(afterClickStage.stage)) {
      console.log(`[${tag}] 已直接进入登录态，跳过滑块检测`);
    } else if (afterClickStage.stage === STAGES.CAPTCHA) {
      passed = await solveCaptchaIfPresent(page, {
        tag,
        maxRetry: SLIDER_MAX_RETRY,
        paths
      });
    } else {
      // 兜底：也许滑块在稍后才出现；让原有 solver 去做 detection + solve
      passed = await solveCaptchaIfPresent(page, {
        tag,
        maxRetry: SLIDER_MAX_RETRY,
        paths
      });
    }

    if (!passed) {
      console.warn(
        `[${tag}] 自动滑块失败。请在浏览器中手动完成，脚本将持续等待 ${Math.round(
          LOGIN_TIMEOUT_MS / 1000
        )}s`
      );
    }

    const ok = await waitForLoginSettled(page, LOGIN_TIMEOUT_MS);
    if (!ok) {
      throw new Error(
        `等待登录跳转超时（${Math.round(LOGIN_TIMEOUT_MS / 1000)}s）`
      );
    }

    console.log(`[${tag}] 登录成功，当前 URL: ${page.url()}`);

    await saveStorageState(context, paths);
    console.log(
      `[${tag}] 登录态已保存到 ${paths.storageStatePath}`
    );

    if (!options.loginOnly) {
      const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
      return { ok: true, reused: false, paths, ...extra };
    }
    console.log(`[${tag}] 纯登录模式，跳过后续流程`);
    return { ok: true, reused: false, paths };
  } catch (error) {
    // 保留一张失败截图便于排查
    try {
      const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19);
      const shot = path.join(paths.debugDir, `login-failed-${ts}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      console.error(`[${tag}] 失败截图: ${shot}`);
    } catch {
      // 忽略
    }
    throw error;
  } finally {
    // 保留页面不关闭，方便人工接管；这里选择关闭以回收资源
    await page.close().catch(() => {});
  }
}

module.exports = {
  getAccountPaths,
  runShopLogin
};
