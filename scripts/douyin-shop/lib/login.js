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
const { runPostLoginFlow } = require("./post-login-flow");
const {
  STAGES,
  isAuthenticatedStage,
  waitForStage
} = require("./stage");

async function switchToEmailTab(page) {
  const tabLoc = page
    .locator(
      ':text-is("邮箱登录"), div[role="tab"]:has-text("邮箱登录"), span:has-text("邮箱登录")'
    )
    .first();
  if (await tabLoc.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tabLoc.click({ timeout: 2000 }).catch(() => {});
  }
  await page
    .locator('input[type="password"]')
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .catch(() => {});
  return true;
}

async function clearAndFill(input, value) {
  await input.click({ clickCount: 3 }).catch(() => {});
  await input.fill("").catch(() => {});
  await input.fill(value);
}

async function fillCredentials(page, email, password) {
  const emailInput = page
    .locator(
      'input[placeholder="请输入邮箱"], input[placeholder*="邮箱"], input[type="email"]'
    )
    .first();
  await emailInput.waitFor({ state: "visible", timeout: 6000 });

  const passwordInput = page
    .locator('input[type="password"], input[placeholder="密码"]')
    .first();
  await passwordInput.waitFor({ state: "visible", timeout: 6000 });

  await clearAndFill(emailInput, email);
  await clearAndFill(passwordInput, password);
  await page.waitForTimeout(150);

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
}

async function ensureAgreementChecked(page) {
  const failures = [];
  try {
    const checkbox = page.locator('input[type="checkbox"]').first();
    if (!(await checkbox.isVisible({ timeout: 2000 }).catch(() => false))) {
      failures.push({
        step: "登录-同意协议",
        message: "未找到复选框元素"
      });
      return { total: 0, clicked: 0, failures };
    }
    const isChecked = await checkbox.isChecked().catch(() => false);
    if (!isChecked) {
      try {
        await checkbox.click({ timeout: 2000 });
      } catch {
        await checkbox.click({ force: true, timeout: 2000 });
      }
    }
    await page.waitForTimeout(120);

    const finalChecked = await checkbox.isChecked().catch(() => false);
    if (!finalChecked) {
      failures.push({
        step: "登录-同意协议",
        message: "协议复选框勾选失败"
      });
    }
    return { total: 1, clicked: finalChecked ? 1 : 0, failures };
  } catch (e) {
    failures.push({
      step: "登录-同意协议",
      message: `勾选协议异常: ${e.message || e}`
    });
    return { total: 0, clicked: 0, failures };
  }
}

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
  } catch (_error) {
    const captchaShown = await page
      .locator("#captcha_container, text=请完成下列验证后继续")
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
    if (captchaShown) return;
    await page
      .locator('button', { hasText: "登录" })
      .first()
      .click({ force: true, timeout: 1500, noWaitAfter: true })
      .catch(() => {});
  }
}

async function hasLoginUi(page) {
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
      ':text-is("邮箱登录"), div[role="tab"]:has-text("邮箱登录"), span:has-text("邮箱登录")'
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

async function hasAuthenticatedWorkspaceDom(page) {
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

async function isLoggedIn(page) {
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
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isLoggedIn(page)) return true;
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
  }
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
 * 用已缓存的 cookie/storageState 直连工作台，尝试"免密登录"。
 * 返回 true 表示 cookie 仍然有效，可以直接进入后续流程；false 表示需要走账号密码登录。
 */
async function tryReuseCookieLogin(page, tag) {
  const hasCookies = await page.context().cookies().then((cs) => cs.length > 0).catch(() => false);
  if (!hasCookies) return false;

  const probeUrl = SHOP_HOME_URL || SHOP_LOGIN_URL;
  console.log(`[${tag}] 检测到已有 cookie，尝试直连 ${probeUrl}`);
  try {
    await page.goto(probeUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  } catch (error) {
    console.warn(`[${tag}] 直连工作台失败: ${error.message || error}`);
    return false;
  }

  // 给 SPA 一点时间决定跳转与渲染（失效时可能先停在 home URL 再出登录表单）
  const settled = await waitForStage(
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
    { timeoutMs: 10000, intervalMs: 320 }
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
  const selectedShopNames = Array.isArray(options.selectedShopNames)
    ? options.selectedShopNames.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  const postLoginOptions = { processedNames, daysToExport, selectedShopNames };

  const page = await context.newPage();
  const tag = email;

  try {
    const t0 = Date.now();

    // 优先走 cookie 复用：如果账号目录下已有 storageState，直接探测工作台。
    // cookie 有效就跳过整个登录流程；无效再回落到账号密码登录。
    if (await tryReuseCookieLogin(page, tag)) {
      console.log(`[${tag}] cookie 仍然有效，跳过账号密码登录`);
      await saveStorageState(context, paths);
      const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
      return { ok: true, reused: true, paths, ...extra };
    }

    console.log(`[${tag}] 打开抖店登录页 ${SHOP_LOGIN_URL}`);
    await page.goto(SHOP_LOGIN_URL, { waitUntil: "domcontentloaded" });
    // 抖店页面长连接/埋点会让 networkidle 几乎永远触发不到，
    // 等到「登录表单 / 选店页 / 工作台 / 滑块」任一阶段出现即可。
    const preFormStage = await waitForStage(
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
      { timeoutMs: 8000 }
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
      const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
      return { ok: true, reused: true, paths, ...extra };
    }

    // 只有在「真的处于登录表单」时才执行 tab 切换/填密码；其它阶段全部按异常走兜底路径
    if (preFormStage.stage !== STAGES.LOGIN_FORM && preFormStage.stage !== STAGES.CAPTCHA) {
      console.warn(
        `[${tag}] 登录页阶段非预期 (${preFormStage.stage})，仍尝试按登录表单流程走一次`
      );
    }

    // === Gate: 准备填表前再确认一次阶段 ===
    const beforeFillStage = (await detectStage(page)).stage;
    if (isAuthenticatedStage(beforeFillStage)) {
      console.log(
        `[${tag}] 填表前发现已登录 (stage=${beforeFillStage})，跳过填表/点击登录`
      );
      await saveStorageState(context, paths);
      const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
      return { ok: true, reused: true, paths, ...extra };
    }

    if (beforeFillStage === STAGES.LOGIN_FORM) {
      console.log(`[${tag}] 切换到邮箱登录 tab`);
      await switchToEmailTab(page);

      console.log(`[${tag}] 填写邮箱与密码`);
      await fillCredentials(page, email, password);
      await ensureAgreementChecked(page);
    } else if (beforeFillStage === STAGES.CAPTCHA) {
      console.log(`[${tag}] 进入页面即遇滑块，直接跳到滑块处理阶段`);
    } else {
      console.warn(
        `[${tag}] 未能识别为登录表单阶段 (${beforeFillStage})，仍按标准流程执行一次填表`
      );
      await switchToEmailTab(page);
      await fillCredentials(page, email, password);
      await ensureAgreementChecked(page);
    }

    // === Gate: 点击登录按钮之前再确认一次 ===
    const beforeClickStage = (await detectStage(page)).stage;
    if (isAuthenticatedStage(beforeClickStage)) {
      console.log(
        `[${tag}] 点登录前发现已登录 (stage=${beforeClickStage})，跳过点击`
      );
      await saveStorageState(context, paths);
      const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
      return { ok: true, reused: true, paths, ...extra };
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
    const afterClickStage = await waitForStage(
      page,
      [
        STAGES.CAPTCHA,
        STAGES.SHOP_PICKER,
        STAGES.COMPASS_VIDEO,
        STAGES.COMPASS_GRAPHIC,
        STAGES.COMPASS_OTHER,
        STAGES.FXG_WORKSPACE
      ],
      { timeoutMs: 3500, intervalMs: 180 }
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

    const extra = await runPostLoginFlow(page, tag, paths, postLoginOptions);
    return { ok: true, reused: false, paths, ...extra };
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
