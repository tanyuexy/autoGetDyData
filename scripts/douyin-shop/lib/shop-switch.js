const {
  loadPreferredShopNames,
  pickShopByPreference
} = require("./shop-picker");
const { waitForDomLoaded } = require("./page-utils");

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

// 下拉里的"切换数据视角"选项。
// 实地 DOM（2026-04 罗盘）：
//   body ... > div.ecom-dropdown.ecom-dropdown-placement-bottomRight
//     > div.dropDownWrapper-y.UAKu
//       > div.switchAccount-jAhEuJ "切换数据视角"
// 注意：ecom-dropdown 渲染出来的菜单项结构是多层嵌套，里面可能还包含图标 span，
// 严格 `:text-is` 会因为节点规范化后的文本带额外空白/图标 alt 而匹配失败，
// 这里统一用 `:has-text` 宽松匹配；多个候选按优先级排列，命中即用。
// 首选精确 class `switchAccount`，兜底再走 ecom-dropdown-item 等通用结构。
const SWITCH_ENTRY_SELECTORS = [
  'div[class*="switchAccount"]',
  'div[class*="switchAccount"]:has-text("切换数据视角")',
  'li[class*="ecom-dropdown-item"]:has-text("切换数据视角")',
  'div[class*="ecom-dropdown-item"]:has-text("切换数据视角")',
  '[class*="ecom-dropdown-menu"] *:has-text("切换数据视角")',
  'div[role="menuitem"]:has-text("切换数据视角")',
  'li[role="menuitem"]:has-text("切换数据视角")',
  'text=切换数据视角'
];

// 下拉外层面板容器（Portal 到 body 的 ecom-dropdown 根）。
// 用来判断"下拉是否真的展开"，比直接判断菜单项更稳：组件在关闭态下会给根加
// hidden / display:none，我们要求根处于非 hidden 才算展开。
const DROPDOWN_WRAPPER_SELECTOR =
  'div.ecom-dropdown:not(.ecom-dropdown-hidden) [class*="dropDownWrapper"]';

// 页面左上角"店铺名"展示区（罗盘首页抬头上的店铺标题），
// 右上角 userName 不稳定（多店铺/子账号场景不一定渲染），这是更稳的兜底。
const SHOP_TITLE_SELECTORS = [
  '[class*="shopName"]',
  '[class*="shop-name"]',
  '[class*="shopTitle"]',
  '[class*="ShopName"]',
  'header [class*="shop"]'
];

const SWITCH_MODAL_ROOT = "#ecom-login-account-modal";
const DROPDOWN_READY_TIMEOUT_MS = 6000;
const SWITCH_ENTRY_READY_TIMEOUT_MS = 7500;

const { logMilestone, logWarn } = require("./shop-log");

function nowLog() {}

function warnLog(tag, msg) {
  logWarn(`[${tag}] ${msg}`);
}

/**
 * 读取当前登录店铺名。按稳定性从高到低依次尝试：
 *  1) 页面左上角的店铺标题（多店铺/子账号场景也会显示当前店铺名）
 *  2) 右上角 userName（单店账号会把当前店铺名显示在用户触发器里）
 *  3) 整个右上角触发器的 textContent（兜底）
 *  4) document.title 里的店铺名（部分页面会带）
 * 返回空字符串表示无法读取。
 */
async function readCurrentShopName(page) {
  // 步骤 1：左上角店铺标题（最稳，多店铺/子账号场景都有）
  for (const sel of SHOP_TITLE_SELECTORS) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      const t = ((await el.textContent().catch(() => "")) || "").trim();
      // 页面左上角还可能挂着店铺等级等数字，截断到第一个常见后缀为止
      const cleaned = t
        .replace(/\s+/g, "")
        .match(/[^\s]*(?:旗舰店|专营店|专卖店|官方旗舰店|小店|直营店)/);
      if (cleaned && cleaned[0]) return cleaned[0];
      if (t && t.length <= 40) return t;
    }
  }

  // 步骤 2：右上角 userName（单店账号里通常是店铺名本身）
  const nameNode = page
    .locator('span[class*="userName"], div[class*="userName"]')
    .first();
  if (await nameNode.isVisible({ timeout: 1500 }).catch(() => false)) {
    const text = ((await nameNode.textContent().catch(() => "")) || "").trim();
    if (text) return text;
  }

  // 步骤 3：整个触发器 textContent
  for (const sel of USER_TRIGGER_SELECTORS) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      const t = ((await el.textContent().catch(() => "")) || "").trim();
      if (t && t.length <= 40) return t;
    }
  }

  // 步骤 4：document.title（例如 "莲藕医药专营店-罗盘"）
  const title = (await page.title().catch(() => "")) || "";
  const m = title.match(/[^\s|\-·]*(?:旗舰店|专营店|专卖店|官方旗舰店|小店|直营店)/);
  if (m && m[0]) return m[0];

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
    // 抖店/罗盘会有多段重定向或 SPA 切换，偶发导致 goto 被后续导航打断（net::ERR_ABORTED）。
    // 这里做两段式兜底：
    // 1) 先尝试 goto
    // 2) 如失败，短暂等待后检查当前 URL 是否已在 /shop；否则再重试一次
    let navigated = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await page.goto(COMPASS_HOME_URL, {
          waitUntil: "domcontentloaded",
          timeout: 20000
        });
        navigated = true;
        break;
      } catch (error) {
        const msg = error?.message || String(error);
        warnLog(tag, `跳转罗盘首页失败${attempt === 0 ? "（将重试）" : ""}: ${msg}`);
        // 让页面把正在进行的导航走完一帧，再判断是否其实已经到位
        await page.waitForTimeout(800).catch(() => {});
        const cur = page.url() || "";
        if (/https?:\/\/compass\.jinritemai\.com\/shop\/?($|\?|#)/.test(cur)) {
          navigated = true;
          break;
        }
      }
    }
    if (!navigated) return false;
  }
  // 等页面 DOM 更“稳定”一些，再以右上角触发器出现作为就绪信号
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  // readyState=complete 并非总是必要，但可以降低“页面还在替换 DOM”就开始下一步的概率
  await page
    .waitForFunction(() => document.readyState === "complete", null, {
      timeout: 8000,
      polling: 200
    })
    .catch(() => {});

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

  // 关键：下拉是 Portal 到 body 的 ecom-dropdown，展开有动画，
  // Playwright 的 state: "visible" 在动画初态（opacity:0 / transform）下
  // 偶尔会判定为可见，但元素此时还没挂"切换数据视角"子节点；
  // 反过来，即使 DOM 已经挂好节点，面板本身如果还带 display:none 也会被判不可见。
  // 这里直接用 waitForFunction 轮询真实 DOM：
  //   条件 A：body 上存在 `div[class*="switchAccount"]` 元素
  //   条件 B：该元素有非零 bounding box（意味着父面板的 display/visibility 已经放开）
  // 比 `waitFor({ state: "visible" })` 稳得多。
  const domReady = await page
    .waitForFunction(
      () => {
        const nodes = Array.from(
          document.querySelectorAll('div[class*="switchAccount"]')
        );
        for (const n of nodes) {
          const text = (n.textContent || "").replace(/\s+/g, "");
          if (!text.includes("切换数据视角")) continue;
          const rect = n.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return true;
        }
        return false;
      },
      null,
      { timeout: DROPDOWN_READY_TIMEOUT_MS, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);

  if (!domReady) {
    // 尚未看到"切换数据视角"。先看看"退出登录"是否出现，出现说明下拉已经开了
    // 但当前账号的菜单里真的没有"切换数据视角"条目；否则多半是下拉没开，再点一次兜底。
    const logoutSeen = await page
      .locator(':text-is("退出登录")')
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false);
    if (!logoutSeen) {
      await trigger.click({ timeout: 1500, force: true }).catch(() => {});
      // 再给一次 DOM 渲染机会
      await page
        .waitForFunction(
          () => {
            const n = document.querySelector(
              'div[class*="switchAccount"]'
            );
            if (!n) return false;
            const r = n.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          },
          null,
          { timeout: Math.max(4000, Math.round(DROPDOWN_READY_TIMEOUT_MS / 2)), polling: 100 }
        )
        .catch(() => {});
    }
  }

  // 即便 switchAccount 已经可见，面板内部的 hover/click 态还有一帧过渡，
  // 兜底再等 500ms 让菜单项稳定下来再交给下一步点击。
  await page.waitForTimeout(500);

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
  // 直接按精确 class 拿"切换数据视角"节点，避免复合选择器在 :has-text 下的误判。
  // 用 page.locator 的 count() > 0 + DOM 可点击判断，比 isVisible 对动画态更宽容。
  const entry = page
    .locator('div[class*="switchAccount"]')
    .filter({ hasText: "切换数据视角" })
    .first();

  // 等"switchAccount"至少挂进 DOM，且有非零尺寸
  const entryReady = await page
    .waitForFunction(
      () => {
        const nodes = Array.from(
          document.querySelectorAll('div[class*="switchAccount"]')
        );
        for (const n of nodes) {
          const text = (n.textContent || "").replace(/\s+/g, "");
          if (!text.includes("切换数据视角")) continue;
          const r = n.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return true;
        }
        return false;
      },
      null,
      { timeout: SWITCH_ENTRY_READY_TIMEOUT_MS, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);

  if (!entryReady) {
    // 没命中任何候选选择器时，dump 当前下拉中可见菜单项的文本，便于排查选择器漂移
    try {
      const visibleTexts = await page
        .locator(
          '[class*="ecom-dropdown-menu"] [class*="ecom-dropdown-item"], [role="menuitem"], [class*="dropDownWrapper"] *'
        )
        .allInnerTexts()
        .catch(() => []);
      if (visibleTexts && visibleTexts.length > 0) {
        nowLog(
          tag,
          `当前下拉菜单实际项: ${visibleTexts
            .map((s) => (s || "").replace(/\s+/g, ""))
            .filter(Boolean)
            .slice(0, 10)
            .join(" | ")}`
        );
      }
    } catch {
      // 忽略
    }
    warnLog(
      tag,
      `下拉中没有"切换数据视角"入口（等待 ${SWITCH_ENTRY_READY_TIMEOUT_MS}ms 后仍未出现，可能当前页面不支持）`
    );
    return false;
  }

  const t0 = Date.now();
  // 依次尝试三种点击：普通点击 → force 点击 → 直接 DOM click()
  // 最后一档是为了规避"元素已挂但被父级动画层覆盖"导致的命中失败。
  await entry.click({ timeout: 2000 }).catch(async () => {
    await entry.click({ force: true, timeout: 1500 }).catch(async () => {
      await page
        .evaluate(() => {
          const nodes = Array.from(
            document.querySelectorAll('div[class*="switchAccount"]')
          );
          const hit = nodes.find((n) =>
            (n.textContent || "").includes("切换数据视角")
          );
          if (hit) hit.click();
        })
        .catch(() => {});
    });
  });

  // 等弹窗真的打开。
  // 注意：`#ecom-login-account-modal` 是个常驻挂载点容器，初始态也可能挂在 body 上，
  // 且自身尺寸/visibility 可能让 Playwright 的 `state: "visible"` 判定失真。
  // 这里改为：在 `#ecom-login-account-modal` 下真的能看到 `auxo-modal-wrap` 且其
  // bounding box 非零，才认为弹窗已展示出来。
  const modalShown = await page
    .waitForFunction(
      () => {
        const root = document.querySelector("#ecom-login-account-modal");
        if (!root) return false;
        const wrap = root.querySelector(
          '.auxo-modal-wrap, [class*="auxo-modal-wrap"]'
        );
        if (!wrap) return false;
        const r = wrap.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      },
      null,
      { timeout: 8000, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);
  if (!modalShown) {
    warnLog(tag, '点击"切换数据视角"后弹窗未出现');
    return false;
  }

  // 等店铺列表加载完成。弹窗内部会先有 `auxo-spin` loading 骨架，
  // 店铺条目新版 DOM 里不再一定带 `roleItem` 这个 class 名
  //（实测也见过 `index_rootContainer__xxx > auxo-spin-container` 直接渲染 `子账号 店铺名 状态` 结构）。
  // 所以条件放宽：
  //   条件 A：存在 `[class*="roleItem"]` 可见项，或
  //   条件 B：`auxo-modal-body` 里已经有"请选择店铺"文案 + 至少 1 个"子账号"标签。
  const listReady = await page
    .waitForFunction(
      () => {
        const root = document.querySelector("#ecom-login-account-modal");
        if (!root) return false;
        // 条件 A：老结构
        const roleItems = root.querySelectorAll('[class*="roleItem"]');
        for (const n of roleItems) {
          const r = n.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return true;
        }
        // 条件 B：新结构 —— auxo-modal-body 里已经渲染出"子账号"标签
        const body = root.querySelector(
          '.auxo-modal-body, [class*="auxo-modal-body"]'
        );
        if (!body) return false;
        const bodyText = (body.textContent || "").replace(/\s+/g, "");
        if (!bodyText.includes("请选择店铺")) return false;
        // 至少要看到一个"子账号"标签文本，或店铺后缀
        return (
          bodyText.includes("子账号") ||
          /旗舰店|专营店|专卖店|官方旗舰店|小店|直营店/.test(bodyText)
        );
      },
      null,
      { timeout: 15000, polling: 200 }
    )
    .then(() => true)
    .catch(() => false);
  if (!listReady) {
    warnLog(tag, "切店铺弹窗列表加载超时（未渲染店铺项）");
    return false;
  }

  // 再等一小会儿让其余条目也渲染进来（列表较长时会分帧 paint）
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

  // 老结构：`[class*="roleItem"]` 作为每一项容器，里面有 `introName`
  const legacyItems = modal.locator('[class*="roleItem"]');
  const legacyCount = await legacyItems.count().catch(() => 0);
  if (legacyCount > 0) {
    const results = [];
    for (let i = 0; i < legacyCount; i += 1) {
      const item = legacyItems.nth(i);
      let name = "";
      const nameLoc = item.locator('[class*="introName"]').first();
      if (await nameLoc.count().catch(() => 0)) {
        name = ((await nameLoc.textContent().catch(() => "")) || "").trim();
      }
      if (!name) {
        const raw = ((await item.textContent().catch(() => "")) || "").trim();
        name = raw
          .replace(/子账号/g, "")
          .replace(/正常营业|停业|已冻结/g, "")
          .trim();
      }
      results.push({ index: i, name, locator: item });
    }
    return results;
  }

  // 新结构：弹窗里不一定有 `roleItem` class，但每一行一定有一个"子账号"标签，
  // 且包含店铺名（以"旗舰店/专营店/专卖店/..."结尾）。
  // 策略：在 auxo-modal-body 内用 evaluate 提取每一行的 DOM path 和名称，
  // 然后通过 page.locator 配合 nth 索引重新定位（确保 click 时仍然是 Playwright 管理的 Locator）。
  const parsed = await page
    .evaluate(() => {
      const root = document.querySelector("#ecom-login-account-modal");
      if (!root) return [];
      const body =
        root.querySelector('.auxo-modal-body') ||
        root.querySelector('[class*="auxo-modal-body"]');
      if (!body) return [];

      // 找到所有"子账号"标签节点，向上找"同行容器"
      // 行容器判定：向上走直到它的 textContent 同时包含店铺名后缀和状态文案
      const tagNodes = Array.from(body.querySelectorAll("*")).filter((el) => {
        const t = (el.textContent || "").replace(/\s+/g, "");
        return (
          t === "子账号" &&
          el.children.length === 0 // 叶子节点，避免把一整块都拿出来
        );
      });

      const rows = [];
      const seen = new Set();
      for (const tag of tagNodes) {
        let cur = tag;
        for (let up = 0; up < 6 && cur && cur !== body; up += 1) {
          cur = cur.parentElement;
          if (!cur) break;
          const txt = (cur.textContent || "").replace(/\s+/g, "");
          const hasSuffix =
            /旗舰店|专营店|专卖店|官方旗舰店|小店|直营店/.test(txt);
          const hasStatus = /正常营业|停业|已冻结/.test(txt);
          if (hasSuffix && hasStatus && !seen.has(cur)) {
            // 尽量提取店铺名：去掉"子账号"/状态词/孤立的"旗舰店 专营店"类型标签
            const nameMatch = txt.match(
              /([^\s子账号]*?(?:旗舰店|专营店|专卖店|官方旗舰店|小店|直营店))/
            );
            const name = nameMatch
              ? nameMatch[1].replace(/^子账号/, "")
              : txt
                  .replace(/子账号/g, "")
                  .replace(/正常营业|停业|已冻结/g, "")
                  .trim();
            seen.add(cur);
            rows.push({ index: rows.length, name });
            break;
          }
        }
      }
      // 把行节点标记到 DOM 上，便于 Playwright 重新定位
      Array.from(seen).forEach((el, idx) => {
        el.setAttribute("data-shop-row-idx", String(idx));
      });
      return rows;
    })
    .catch(() => []);

  const results = [];
  for (const row of parsed) {
    const locator = modal
      .locator(`[data-shop-row-idx="${row.index}"]`)
      .first();
    results.push({ index: row.index, name: row.name, locator });
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
 * 先在当前页尝试打开「切换数据视角」弹窗；若当前页菜单里没有该入口（例如视频明细页），
 * 再回罗盘首页重试。避免每次切店都无条件 goto /shop。
 */
async function openSwitchShopModal(page, tag) {
  if (await openUserDropdown(page, tag)) {
    if (await clickSwitchEntryAndWaitModal(page, tag)) return true;
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);
  if (await ensureOnCompassHome(page, tag)) {
    if (await openUserDropdown(page, tag)) {
      if (await clickSwitchEntryAndWaitModal(page, tag)) return true;
    }
  }
  return false;
}

/**
 * 整体流程：展开右上角用户菜单 → 点击"切换数据视角"（必要时先回罗盘首页）→
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

  if (!(await openSwitchShopModal(page, tag))) {
    return { switched: false, reason: "modal-not-opened" };
  }

  // 读取 modal 店铺列表
  const items = await readModalShopItems(page);
  const availableNames = items.map((it) => it.name).filter(Boolean);
  nowLog(
    tag,
    `切店铺弹窗共 ${items.length} 个店铺，前 5 个: ${availableNames
      .slice(0, 5)
      .join(" | ")}${availableNames.length > 5 ? " ..." : ""}`
  );

  // 过滤已处理的店铺后按优先级匹配
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

  // 点击目标店铺，切换后罗盘会整页重载
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

  await waitForDomLoaded(page, { tag });

  logMilestone(tag, `切店 → ${hit.item.name} (${Date.now() - t0}ms)`);

  return {
    switched: true,
    name: hit.item.name,
    preferred: hit.preferred,
    availableNames
  };
}

module.exports = {
  readCurrentShopName,
  switchToNextPreferredShop
};
