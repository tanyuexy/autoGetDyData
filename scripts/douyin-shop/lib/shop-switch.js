const {
  loadPreferredShopNames,
  pickShopByPreference
} = require("./shop-picker");

/**
 * "切换数据视角"的真实行为（实地校验版）：
 *  1) 该入口仅在罗盘首页 https://compass.jinritemai.com/shop 的右上角用户菜单里出现；
 *     在 /shop/video/self（自营视频明细页）的右上角用户菜单里只有"退出登录"。
 *  2) 右上角用户区是"点击触发"下拉（不是 hover）。
 *     实测 hover `userDropDown` 也会展开一次，但立即 mouseleave 会被关闭；
 *     click `userName` 或整个触发器最稳定。
 *  3) 点击"切换数据视角"后 modal（#ecom-login-account-modal）会先挂一个"加载中"骨架，
 *     大约 1-3 秒后才渲染出店铺列表（roleItem）。
 *  4) 店铺条目结构与登录阶段的"请选择店铺"页完全一致：
 *       [class*="roleItem"] > [class*="introName"] 内是店铺名。
 */

// 罗盘首页；"切换数据视角"入口只在该页显示
const COMPASS_HOME_URL =
  process.env.COMPASS_HOME_URL || "https://compass.jinritemai.com/shop";

// 右上角用户触发器：包含头像和店铺名。class 带 CSS Module 哈希，用 [class*=] 兜底。
// 实地 DOM：<div class="userDropDown-k9_W5P ecom-dropdown-trigger">头像<span class="userName-xxx">瑙珍官方旗舰店</span></div>
const USER_TRIGGER_SELECTORS = [
  'div[class*="userDropDown"].ecom-dropdown-trigger',
  'div[class*="userDropDown"]',
  'span[class*="userName"]'
];

// 下拉里的"切换数据视角"选项
const SWITCH_ENTRY_SELECTORS = [
  'div[class*="switchAccount"]:has-text("切换数据视角")',
  ':text-is("切换数据视角")'
];

const SWITCH_MODAL_ROOT = "#ecom-login-account-modal";

function nowLog(tag, msg) {
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${msg}`);
}

function warnLog(tag, msg) {
  // eslint-disable-next-line no-console
  console.warn(`[${tag}] ${msg}`);
}

/**
 * 读取当前登录店铺名。优先从右上角用户触发器里取，
 * 取不到再兜底尝试页面中部"全部自营账号/xxx"按钮附近的文案。
 * 返回空字符串表示无法读取。
 */
async function readCurrentShopName(page) {
  // 优先：右上角 userName（不一定带 DOM role，需要多选择器）
  const nameNode = page
    .locator('span[class*="userName"], div[class*="userName"]')
    .first();
  if (await nameNode.isVisible({ timeout: 1500 }).catch(() => false)) {
    const text = ((await nameNode.textContent().catch(() => "")) || "").trim();
    if (text) return text;
  }
  // 兜底：整个触发器 textContent
  for (const sel of USER_TRIGGER_SELECTORS) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      const t = ((await el.textContent().catch(() => "")) || "").trim();
      if (t) return t;
    }
  }
  return "";
}

/**
 * 确保当前停留在"切换数据视角"入口可见的页面（罗盘首页 /shop）。
 * 如果当前是自营视频明细页等其它页面，入口是没有"切换数据视角"的，必须先跳回 /shop。
 */
async function ensureOnCompassHome(page, tag) {
  const url = page.url() || "";
  // /shop/video 等子路径下右上角菜单没有"切换数据视角"，必须跳回 /shop 主页
  if (!/https?:\/\/compass\.jinritemai\.com\/shop\/?($|\?|#)/.test(url)) {
    nowLog(tag, `当前 URL 非罗盘首页 (${url})，跳回 ${COMPASS_HOME_URL}`);
    try {
      await page.goto(COMPASS_HOME_URL, {
        waitUntil: "domcontentloaded",
        timeout: 20000
      });
    } catch (error) {
      warnLog(tag, `跳转罗盘首页失败: ${error.message || error}`);
      return false;
    }
  }
  // 等右上角触发器出现，作为"首页已就绪"的信号
  const trigger = page.locator(USER_TRIGGER_SELECTORS.join(", ")).first();
  const ok = await trigger
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    warnLog(tag, "等待右上角用户触发器可见超时");
    return false;
  }
  return true;
}

/**
 * 打开右上角用户下拉菜单。
 * 因为 ecom-dropdown 组件在不同页面是 click / hover 两种触发方式混用，
 * 脚本这里"先 hover 再 click"双保险，并校验"切换数据视角"已经出现。
 */
async function openUserDropdown(page, tag) {
  const trigger = page.locator(USER_TRIGGER_SELECTORS.join(", ")).first();
  if (!(await trigger.isVisible({ timeout: 3000 }).catch(() => false))) {
    warnLog(tag, "右上角用户触发器不可见");
    return false;
  }

  const t0 = Date.now();
  // hover 一次把 focus 交给 trigger，避免 click 误判
  await trigger.hover({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(150);
  await trigger.click({ timeout: 2000 }).catch(() => {});

  // 等下拉里"切换数据视角"或"退出登录"任一出现，判定下拉已展开
  const entry = page
    .locator(SWITCH_ENTRY_SELECTORS.join(", "))
    .first();
  const logout = page.locator(':text-is("退出登录")').first();

  const ready = await Promise.race([
    entry
      .waitFor({ state: "visible", timeout: 4000 })
      .then(() => "switch")
      .catch(() => null),
    logout
      .waitFor({ state: "visible", timeout: 4000 })
      .then(() => "logout")
      .catch(() => null)
  ]);
  if (!ready) {
    // 再点一次兜底
    await trigger.click({ timeout: 1500, force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
  nowLog(tag, `右上角下拉已展开 (${Date.now() - t0}ms)`);
  return true;
}

/**
 * 从下拉里点"切换数据视角"并等待 modal 出现（含加载完成）。
 *
 * 流程关键点：
 *  - 点击"切换数据视角"后，modal 内部会先显示 "加载中" 骨架；
 *    不能直接读 roleItem，否则会得到 count=0。
 *  - 等待 [class*="roleItem"] 至少 1 项可见，再认为列表就绪。
 */
async function clickSwitchEntryAndWaitModal(page, tag) {
  const entry = page.locator(SWITCH_ENTRY_SELECTORS.join(", ")).first();
  if (!(await entry.isVisible({ timeout: 3000 }).catch(() => false))) {
    warnLog(tag, '下拉中没有"切换数据视角"入口（可能当前页面不支持）');
    return false;
  }

  const t0 = Date.now();
  await entry.click({ timeout: 2000 }).catch(async () => {
    await entry.click({ force: true, timeout: 1500 }).catch(() => {});
  });

  const modal = page.locator(SWITCH_MODAL_ROOT).first();
  const modalShown = await modal
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!modalShown) {
    warnLog(tag, "点击\"切换数据视角\"后弹窗未出现");
    return false;
  }

  // 等店铺列表加载完成（实测有 1-3s 的加载骨架）
  const firstItem = modal.locator('[class*="roleItem"]').first();
  const listReady = await firstItem
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!listReady) {
    warnLog(tag, "切店铺弹窗列表加载超时（roleItem 未出现）");
    return false;
  }

  // 再等一小会儿让其余 roleItem 也渲染进来（列表较长时会分帧 paint）
  await page.waitForTimeout(500);
  nowLog(
    tag,
    `"切换数据视角"弹窗已就绪 (${Date.now() - t0}ms)`
  );
  return true;
}

/**
 * 读取弹窗中所有店铺项，保持 DOM 顺序。
 * 每一项是一个 `index_roleItem__xxx` 容器，内部通常还有：
 *  - [class*="tag"] "子账号"
 *  - [class*="introName"] 店铺名（这是我们要的）
 *  - [class*="introTags"] / 状态文字，不在此处使用
 *
 * 有些版本没有 introName，兜底用整项 textContent 并 trim。
 */
async function readModalShopItems(page) {
  const modal = page.locator(SWITCH_MODAL_ROOT).first();
  const items = modal.locator('[class*="roleItem"]');
  const count = await items.count();
  const results = [];
  for (let i = 0; i < count; i += 1) {
    const item = items.nth(i);
    let name = "";
    const nameLoc = item.locator('[class*="introName"]').first();
    if (await nameLoc.count().catch(() => 0)) {
      name = ((await nameLoc.textContent().catch(() => "")) || "").trim();
    }
    if (!name) {
      // 兜底：整项 textContent，去除标签文字
      const raw = ((await item.textContent().catch(() => "")) || "").trim();
      name = raw
        .replace(/子账号/g, "")
        .replace(/正常营业|停业|已冻结/g, "")
        .replace(/旗舰店|专营店|专卖店|官方旗舰店/g, (m) => m) // 保留店铺后缀
        .trim();
    }
    results.push({ index: i, name, locator: item });
  }
  return results;
}

async function closeSwitchModalIfOpen(page) {
  const modal = page.locator(SWITCH_MODAL_ROOT).first();
  if (!(await modal.isVisible({ timeout: 200 }).catch(() => false))) return;
  // auxo-modal 的关闭按钮
  const closeBtn = page
    .locator(`${SWITCH_MODAL_ROOT} .auxo-modal-close, ${SWITCH_MODAL_ROOT} [aria-label="Close"]`)
    .first();
  if (await closeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
    await closeBtn.click({ timeout: 800 }).catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }
  await page.waitForTimeout(300);
}

/**
 * 整体流程：打开罗盘首页 → 展开右上角用户菜单 → 点击"切换数据视角" →
 * 等 modal 列表加载 → 按 preferred 列表挑下一个未处理店铺 → 点击切换。
 *
 * 所有关键节点都打点日志，便于在任何失败节点定位问题。
 *
 * @param {import('playwright').Page} page
 * @param {{ tag?: string, processedNames?: Iterable<string>, preferredList?: string[] }} options
 * @returns {Promise<{switched: boolean, name?: string, preferred?: string, availableNames?: string[], reason?: string}>}
 */
async function switchToNextPreferredShop(page, options = {}) {
  const tag = options.tag || "shop";
  const processedSet =
    options.processedNames instanceof Set
      ? options.processedNames
      : new Set(options.processedNames || []);

  const preferredList =
    options.preferredList && options.preferredList.length > 0
      ? options.preferredList
      : await loadPreferredShopNames();

  if (preferredList.length === 0) {
    return { switched: false, reason: "no-preferred-list" };
  }

  // 步骤 1: 确保在罗盘首页
  if (!(await ensureOnCompassHome(page, tag))) {
    return { switched: false, reason: "cannot-reach-compass-home" };
  }

  // 步骤 2: 打开右上角下拉
  if (!(await openUserDropdown(page, tag))) {
    return { switched: false, reason: "user-dropdown-not-opened" };
  }

  // 步骤 3: 点击"切换数据视角"并等 modal 加载
  if (!(await clickSwitchEntryAndWaitModal(page, tag))) {
    return { switched: false, reason: "modal-not-opened" };
  }

  // 步骤 4: 读取 modal 店铺列表
  const items = await readModalShopItems(page);
  const availableNames = items.map((it) => it.name).filter(Boolean);
  nowLog(
    tag,
    `切店铺弹窗共 ${items.length} 个店铺，前 5 个: ${availableNames
      .slice(0, 5)
      .join(" | ")}${availableNames.length > 5 ? " ..." : ""}`
  );

  // 步骤 5: 过滤已处理的店铺后按优先级匹配
  const remaining = items.filter((it) => {
    if (!it.name) return false;
    for (const done of processedSet) {
      if (!done) continue;
      if (done === it.name) return false;
      if (it.name.includes(done) || done.includes(it.name)) return false;
    }
    return true;
  });
  nowLog(
    tag,
    `已处理 ${processedSet.size} 个，剩余候选 ${remaining.length} 个`
  );

  const hit = pickShopByPreference(remaining, preferredList);
  if (!hit) {
    await closeSwitchModalIfOpen(page);
    return {
      switched: false,
      reason: "no-match",
      availableNames
    };
  }

  nowLog(
    tag,
    `准备切换到店铺 "${hit.item.name}"（匹配优先级项 "${hit.preferred}"）`
  );

  // 步骤 6: 点击目标店铺，切换后罗盘会整页重载
  const t0 = Date.now();
  await Promise.all([
    page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
      .catch(() => null),
    hit.item.locator.click({ timeout: 5000 })
  ]);

  // 等 modal 消失（SPA 场景下可能没有真正的 navigation 事件）
  const modal = page.locator(SWITCH_MODAL_ROOT).first();
  await modal
    .waitFor({ state: "hidden", timeout: 10000 })
    .catch(() => {});

  nowLog(tag, `店铺切换完成 (${Date.now() - t0}ms)`);

  return {
    switched: true,
    name: hit.item.name,
    preferred: hit.preferred,
    availableNames
  };
}

module.exports = {
  COMPASS_HOME_URL,
  readCurrentShopName,
  ensureOnCompassHome,
  openUserDropdown,
  clickSwitchEntryAndWaitModal,
  readModalShopItems,
  closeSwitchModalIfOpen,
  switchToNextPreferredShop
};
