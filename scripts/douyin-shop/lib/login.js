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
const { selectShopIfPicker, loadPreferredShopNames } = require("./shop-picker");
const { downloadVideoSelfDetail } = require("./video-detail");
const {
  readCurrentShopName,
  ensureOnCompassHome,
  switchToNextPreferredShop
} = require("./shop-switch");

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
 * 登录成功的几种表现（任一命中即返回 true）：
 * 1) URL 跳到抖店工作台 fxg.jinritemai.com 的非登录页
 * 2) URL 跳到罗盘 compass.jinritemai.com
 * 3) 页面 DOM 出现"请选择店铺"（有时 SPA 切换后 URL 未变但页面已切到选店）
 */
async function isLoggedIn(page) {
  const url = page.url() || "";
  if (url.includes("/ffa/mshop") || url.includes("/mshop")) return true;
  if (
    url.includes("fxg.jinritemai.com") &&
    !url.includes("/login/common") &&
    !url.includes("/login/phone") &&
    !url.includes("/login/email")
  ) {
    return true;
  }
  if (url.includes("compass.jinritemai.com")) {
    return true;
  }
  // URL 还未变，但页面已经切到"请选择店铺"视图
  const onPicker = await page
    .locator("text=请选择店铺")
    .first()
    .isVisible({ timeout: 120 })
    .catch(() => false);
  if (onPicker) return true;
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
 * 截图并返回路径，专用于失败时记录现场。
 */
async function captureFailureShot(page, debugDir, kind) {
  try {
    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    const shot = path.join(debugDir, `${kind}-${ts}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return shot;
  } catch {
    return null;
  }
}

/**
 * 下载一次当前店铺的明细；失败单独捕获不影响外层循环。
 *
 * 流程：先回罗盘首页读当前店铺名（视频明细页上读到的右上角并不总是稳定），
 *      然后再进入视频明细页执行下载。
 *
 * @returns {Promise<{ok: boolean, shopName: string, downloadPath?: string, error?: string}>}
 */
async function downloadCurrentShop(page, tag, paths, options = {}) {
  // 先确保在罗盘首页，从这里读右上角的当前店铺名是最可靠的
  let shopName = "";
  try {
    await ensureOnCompassHome(page, tag);
    shopName = await readCurrentShopName(page);
    if (shopName) {
      console.log(`[${tag}] 当前登录店铺: ${shopName}`);
    } else if (options.shopNameHint) {
      // 页面读不到时，用上游传入的 hint（通常是上一次切换/选中的店铺名）
      shopName = String(options.shopNameHint).trim();
      console.warn(
        `[${tag}] 页面未能读取到当前店铺名，回退使用上游 hint "${shopName}"`
      );
    } else {
      console.warn(`[${tag}] 罗盘首页未能读取到当前店铺名，将以 "unknown" 归档`);
    }
  } catch (error) {
    console.warn(`[${tag}] 读取当前店铺名异常: ${error.message || error}`);
  }

  const shopTag = shopName ? `${tag}|${shopName}` : tag;

  try {
    const { savePath } = await downloadVideoSelfDetail(page, {
      tag: shopTag,
      saveDir: paths.dataDir,
      shopName: shopName || "unknown"
    });
    return { ok: true, shopName, downloadPath: savePath };
  } catch (error) {
    const msg = error?.message || String(error);
    console.error(`[${shopTag}] 下载短视频明细失败: ${msg}`);
    const shot = await captureFailureShot(page, paths.debugDir, "download-failed");
    if (shot) console.error(`[${shopTag}] 失败截图: ${shot}`);
    return { ok: false, shopName, error: msg };
  }
}

/**
 * 登录成功后统一执行的后续动作：
 * 1) 若停留在"请选择店铺"页，按 default-add-accounts.json 顺序选中第一个匹配项
 * 2) 在当前店铺完成一次"视频明细"下载（文件归档到 data/<店铺名>/）
 * 3) 通过右上角头像 → "切换数据视角" → 按 default-add-accounts.json
 *    顺序依次切换到后续每一个匹配的店铺，每次切换后都下载一次明细
 * 4) 直到切店铺弹窗中再也找不到匹配且未处理的店铺为止
 *
 * 每一步都尽量独立捕获异常，避免因后置步骤失败而否定登录动作本身的成果。
 */
async function runPostLoginFlow(page, tag, paths) {
  const result = {
    shopPicked: null,
    shopName: null,
    downloads: [],
    downloadPath: null,
    downloadError: null
  };

  try {
    const pick = await selectShopIfPicker(page, { tag });
    if (pick.picked) {
      result.shopPicked = true;
      result.shopName = pick.name;
    } else {
      result.shopPicked = false;
    }
  } catch (error) {
    console.warn(`[${tag}] 店铺选择阶段异常: ${error.message || error}`);
    result.shopPicked = false;
  }

  const preferredList = await loadPreferredShopNames();
  console.log(
    `[${tag}] 优先级名单 (${preferredList.length}): ${preferredList.join(", ") || "(空)"}`
  );

  // 用名称集合去重，保证同一个店铺不会被重复下载
  const processed = new Set();
  // 兜底防死循环：最多轮 preferredList 长度 + 2 次
  const maxShops = Math.max(preferredList.length || 0, 1) + 2;

  // 首轮的店铺名 hint：登录阶段选店时已知的名字，是第一轮最可靠的来源
  let pendingShopHint = result.shopName || null;

  for (let i = 0; i < maxShops; i += 1) {
    console.log(
      `\n[${tag}] ========== 第 ${i + 1}/${maxShops} 轮 ==========`
    );
    // 下载当前店铺
    const round = await downloadCurrentShop(page, tag, paths, {
      shopNameHint: pendingShopHint
    });
    if (round.shopName) {
      processed.add(round.shopName);
      if (!result.shopName) result.shopName = round.shopName;
    }

    if (round.ok) {
      result.downloads.push({
        shopName: round.shopName,
        downloadPath: round.downloadPath
      });
      if (!result.downloadPath) result.downloadPath = round.downloadPath;
      console.log(
        `[${tag}] ✔ 本轮下载成功，店铺=${round.shopName || "unknown"}`
      );
    } else {
      result.downloads.push({
        shopName: round.shopName,
        error: round.error
      });
      if (!result.downloadError) result.downloadError = round.error;
      console.warn(
        `[${tag}] ✘ 本轮下载失败，店铺=${round.shopName || "unknown"}，原因=${round.error}`
      );
    }

    // 没有优先级名单就不进入多店铺切换循环
    if (preferredList.length === 0) {
      console.log(`[${tag}] 未配置优先级名单，结束循环`);
      break;
    }

    // 尝试切到下一个匹配且未处理的店铺
    let switchRes;
    try {
      switchRes = await switchToNextPreferredShop(page, {
        tag,
        processedNames: processed,
        preferredList
      });
    } catch (error) {
      console.warn(`[${tag}] 切换店铺阶段异常: ${error.message || error}`);
      await captureFailureShot(page, paths.debugDir, "switch-shop-failed");
      break;
    }

    if (!switchRes.switched) {
      if (switchRes.reason === "no-match") {
        console.log(
          `[${tag}] 切店铺弹窗中已无匹配且未处理的店铺，结束循环（共处理 ${processed.size} 个店铺）`
        );
      } else if (switchRes.reason === "modal-not-opened") {
        console.warn(
          `[${tag}] 右上角菜单中没有"切换数据视角"入口（该账号可能只绑定 1 个自营账号），结束循环`
        );
        await captureFailureShot(page, paths.debugDir, "switch-entry-missing");
      } else {
        console.warn(
          `[${tag}] 未能继续切换店铺（原因: ${switchRes.reason || "unknown"}），结束循环`
        );
      }
      break;
    }

    // 切换成功后等页面稳定（罗盘整页重载），并把刚切到的店铺名作为下一轮 hint
    pendingShopHint = switchRes.name || null;
    console.log(
      `[${tag}] 切换成功（目标店铺=${switchRes.name || "?"}），进入下一轮，当前累计已处理: ${[...processed].join(", ")}`
    );
    await page.waitForTimeout(800);
  }

  console.log(
    `\n[${tag}] ========== 多店铺循环结束: 共 ${result.downloads.length} 轮，成功 ${result.downloads.filter((d) => d.downloadPath).length} ==========`
  );
  return result;
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

  // 给 SPA 一点时间决定跳转（cookie 无效时会被踢回登录页）
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const url = page.url() || "";
    if (
      url.includes("/login/common") ||
      url.includes("/login/phone") ||
      url.includes("/login/email")
    ) {
      return false;
    }
    if (await isLoggedIn(page)) return true;
    await page.waitForTimeout(300);
  }
  return isLoggedIn(page);
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

    // 优先走 cookie 复用：如果账号目录下已有 storageState，直接探测工作台。
    // cookie 有效就跳过整个登录流程；无效再回落到账号密码登录。
    if (await tryReuseCookieLogin(page, tag)) {
      console.log(`[${tag}] cookie 仍然有效，跳过账号密码登录`);
      await saveStorageState(context, paths);
      const extra = await runPostLoginFlow(page, tag, paths);
      return { ok: true, reused: true, paths, ...extra };
    }

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
      const extra = await runPostLoginFlow(page, tag, paths);
      return { ok: true, reused: true, paths, ...extra };
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

    // 登录后可能直接成功（无滑块），也可能触发滑块验证。
    // 先给一个短暂的"快速通过"窗口：如果点击登录后页面迅速进入登录成功态
    //（URL 变到 compass/fxg 非登录页，或 DOM 出现"请选择店铺"），就直接跳过滑块检测。
    console.log(`[${tag}] 检查是否触发滑块验证`);
    const fastLogged = await (async () => {
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        if (await isLoggedIn(page)) return true;
        await page.waitForTimeout(150);
      }
      return false;
    })();

    let passed = true;
    if (fastLogged) {
      console.log(`[${tag}] 点击登录后已进入登录态，跳过滑块检测`);
    } else {
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

    // 可选：尝试跳到 home 页（有时登录后会停在过渡页）
    // 注意：若页面已经在罗盘（compass.jinritemai.com）或展示"请选择店铺"，不要再跳，
    // 否则会打断后续的店铺选择 + 明细下载流程。
    const currentUrl = page.url() || "";
    const onCompass = currentUrl.includes("compass.jinritemai.com");
    const onShopPicker = await page
      .locator("text=请选择店铺")
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (
      SHOP_HOME_URL &&
      !currentUrl.includes("/ffa/mshop") &&
      !onCompass &&
      !onShopPicker
    ) {
      await page
        .goto(SHOP_HOME_URL, { waitUntil: "domcontentloaded" })
        .catch(() => {});
      await page.waitForTimeout(500);
    }

    await saveStorageState(context, paths);
    console.log(
      `[${tag}] 登录态已保存到 ${paths.storageStatePath}`
    );

    const extra = await runPostLoginFlow(page, tag, paths);
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
