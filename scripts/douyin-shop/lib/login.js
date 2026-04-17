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

function getAccountPaths(email) {
  const safeName = String(email).replace(/[\\/:*?"<>|]+/g, "_");
  const accountDir = path.join(ACCOUNTS_DIR, safeName);
  return {
    email,
    accountDir,
    storageStatePath: path.join(accountDir, "storageState.json"),
    cookiesPath: path.join(accountDir, "cookies.json"),
    debugDir: path.join(accountDir, "debug")
  };
}

async function ensureAccountPaths(paths) {
  await fs.mkdir(paths.accountDir, { recursive: true });
  await fs.mkdir(paths.debugDir, { recursive: true });
}

/**
 * 切换到"邮箱登录" tab。页面加载后可能默认是手机号登录，必须显式点击。
 * 切完后必须等到"邮箱输入框"和"密码输入框"同时可见，否则下一步会把两个值写到同一个框里。
 */
async function switchToEmailTab(page) {
  const tabLoc = page
    .locator(
      'div[role="tab"]:has-text("邮箱登录"), span:has-text("邮箱登录"), :text-is("邮箱登录")'
    )
    .first();
  if (await tabLoc.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tabLoc.click({ timeout: 2000 }).catch(() => {});
  }
  // 关键：必须等密码输入框也已渲染，否则 fillCredentials 会把密码写进邮箱框
  await page
    .locator('input[type="password"]')
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .catch(() => {});
  return true;
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
  // 用严格 placeholder 匹配，避免把"请输入邮箱"错匹成别的 input。
  const emailInput = page
    .locator(
      'input[placeholder="请输入邮箱"], input[placeholder*="邮箱"], input[type="email"]'
    )
    .first();
  await emailInput.waitFor({ state: "visible", timeout: 6000 });

  // type=password 是最可靠的密码框识别方式；兜底再加上 placeholder。
  const passwordInput = page
    .locator('input[type="password"], input[placeholder="密码"]')
    .first();
  await passwordInput.waitFor({ state: "visible", timeout: 6000 });

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
 * 判断是否已经登录到抖店后台。
 */
async function isLoggedIn(page) {
  const url = page.url() || "";
  if (url.includes("/ffa/mshop") || url.includes("/mshop")) return true;
  if (
    url.includes("fxg.jinritemai.com") &&
    !url.includes("/login")
  ) {
    return true;
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
    // 忽略
  }
}

/**
 * 执行一次完整的抖店邮箱登录流程。
 *
 * @param {import('playwright').BrowserContext} context
 * @param {{ email: string, password: string }} account
 */
async function runShopLogin(context, account) {
  const { email, password } = account;
  const paths = getAccountPaths(email);
  await ensureAccountPaths(paths);

  const page = await context.newPage();
  const tag = email;

  try {
    const t0 = Date.now();
    console.log(`[${tag}] 打开抖店登录页 ${SHOP_LOGIN_URL}`);
    await page.goto(SHOP_LOGIN_URL, { waitUntil: "domcontentloaded" });
    // 抖店页面长连接/埋点会让 networkidle 几乎永远触发不到，
    // 用"邮箱登录 tab 可见"作为就绪信号即可。
    await page
      .locator("text=邮箱登录")
      .first()
      .waitFor({ state: "visible", timeout: 6000 })
      .catch(() => {});

    if (await isLoggedIn(page)) {
      console.log(`[${tag}] 已经处于登录态，跳过登录流程`);
      await saveStorageState(context, paths);
      return { ok: true, reused: true, paths };
    }

    console.log(`[${tag}] 切换到邮箱登录 tab`);
    await switchToEmailTab(page);

    console.log(`[${tag}] 填写邮箱与密码`);
    await fillCredentials(page, email, password);
    await ensureAgreementChecked(page);

    console.log(
      `[${tag}] 表单就绪，耗时 ${Date.now() - t0}ms，点击登录按钮`
    );
    await clickLogin(page);

    // 登录后可能直接成功，也可能触发滑块验证
    console.log(`[${tag}] 检查是否触发滑块验证`);
    const passed = await solveCaptchaIfPresent(page, {
      tag,
      maxRetry: SLIDER_MAX_RETRY,
      paths
    });

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

    // 可选：尝试跳到 home 页（有时登录后会停在过渡页）
    if (SHOP_HOME_URL && !page.url().includes("/ffa/mshop")) {
      await page
        .goto(SHOP_HOME_URL, { waitUntil: "domcontentloaded" })
        .catch(() => {});
      await page.waitForTimeout(500);
    }

    await saveStorageState(context, paths);
    console.log(
      `[${tag}] 登录态已保存到 ${paths.storageStatePath}`
    );
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
