const fs = require("fs/promises");
const path = require("path");

const DEFAULT_ACCOUNTS_FILE = path.resolve(
  process.cwd(),
  "default-add-accounts.json"
);

/**
 * 读取 default-add-accounts.json 中的店铺名称优先级列表。
 * 文件缺失或格式异常时返回空数组，由上层决定兜底策略。
 */
async function loadPreferredShopNames(file = DEFAULT_ACCOUNTS_FILE) {
  try {
    const raw = await fs.readFile(file, "utf-8");
    const json = JSON.parse(raw);
    const arr = Array.isArray(json?.accounts) ? json.accounts : [];
    return arr.map((s) => String(s).trim()).filter(Boolean);
  } catch (error) {
    console.warn(`读取 ${file} 失败: ${error.message}`);
    return [];
  }
}

/**
 * 判断当前是否处于"请选择店铺"页面。
 * 该页面可能出现在：
 * - 罗盘 compass.jinritemai.com（登录后首次选店）
 * - 抖店 fxg.jinritemai.com（部分账号身份切换时）
 */
async function isShopPickerVisible(page) {
  // 首选：页面文案 "请选择店铺"
  const titleVisible = await page
    .locator("text=请选择店铺")
    .first()
    .isVisible({ timeout: 1200 })
    .catch(() => false);
  if (titleVisible) return true;

  // 兜底：列表容器（CSS Modules 会生成 index_roleList__xxx 等哈希类名）
  const listVisible = await page
    .locator('[class*="roleList"]')
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  return listVisible;
}

/**
 * 读取店铺选择页中的所有店铺项（名称 + 可点击元素）。
 * 返回顺序严格按 DOM 顺序，便于后续按优先级匹配。
 */
async function readShopItems(page) {
  // CSS Modules 生成的类名都带哈希，这里用属性选择器兜底匹配。
  const items = page.locator('[class*="roleItem"]');
  const count = await items.count();
  const results = [];
  for (let i = 0; i < count; i += 1) {
    const item = items.nth(i);
    const nameLoc = item.locator('[class*="introName"]').first();
    const name = (await nameLoc.textContent().catch(() => "")) || "";
    results.push({ index: i, name: name.trim(), locator: item });
  }
  return results;
}

/**
 * 在店铺列表中，按 preferred 顺序寻找第一个匹配的店铺。
 * 匹配策略：
 * 1) 严格相等（trim 后）
 * 2) 双向 includes（兼容页面名称带后缀 / 配置名为子串的情况）
 *
 * 返回：{ preferred: 命中的配置名, item: { name, locator } } 或 null。
 */
function pickShopByPreference(items, preferredList) {
  for (const preferred of preferredList) {
    // 先尝试严格相等
    const exact = items.find((it) => it.name === preferred);
    if (exact) return { preferred, item: exact };

    // 再尝试双向包含
    const loose = items.find(
      (it) =>
        it.name &&
        (it.name.includes(preferred) || preferred.includes(it.name))
    );
    if (loose) return { preferred, item: loose };
  }
  return null;
}

/**
 * 若当前页面是店铺选择页，按 default-add-accounts.json 顺序选中第一个匹配项并点击。
 *
 * @param {import('playwright').Page} page
 * @param {{ tag?: string, preferredList?: string[], timeoutMs?: number }} options
 * @returns {Promise<{ picked: boolean, name?: string, preferred?: string, availableNames?: string[] }>}
 */
async function selectShopIfPicker(page, options = {}) {
  const tag = options.tag || "shop";
  const timeoutMs = options.timeoutMs ?? 8000;

  // 等店铺选择页渲染；最多等 timeoutMs，期间 isShopPickerVisible 命中就进入。
  const deadline = Date.now() + timeoutMs;
  let picker = false;
  while (Date.now() < deadline) {
    picker = await isShopPickerVisible(page);
    if (picker) break;
    await page.waitForTimeout(250);
  }
  if (!picker) {
    return { picked: false };
  }

  const preferredList =
    options.preferredList && options.preferredList.length > 0
      ? options.preferredList
      : await loadPreferredShopNames();

  if (preferredList.length === 0) {
    console.warn(
      `[${tag}] 检测到店铺选择页，但未配置优先级名单（default-add-accounts.json），跳过自动选店`
    );
    return { picked: false };
  }

  // 等列表真正渲染出来（至少一个 roleItem 可见）
  await page
    .locator('[class*="roleItem"]')
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .catch(() => {});

  const items = await readShopItems(page);
  const availableNames = items.map((it) => it.name).filter(Boolean);
  console.log(
    `[${tag}] 店铺选择页展示 ${items.length} 个店铺，前 5 个: ${availableNames
      .slice(0, 5)
      .join(" | ")}${availableNames.length > 5 ? " ..." : ""}`
  );

  const hit = pickShopByPreference(items, preferredList);
  if (!hit) {
    console.warn(
      `[${tag}] 未在页面中找到优先级名单里的任一店铺。名单: ${preferredList.join(
        ", "
      )}`
    );
    return { picked: false, availableNames };
  }

  console.log(
    `[${tag}] 命中店铺 "${hit.item.name}"（匹配优先级项 "${hit.preferred}"），点击进入`
  );

  // 点击店铺项，等待随后的 URL 变化（抖店/罗盘都会触发整页跳转）
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
      .catch(() => null),
    hit.item.locator.click({ timeout: 5000 })
  ]);

  // 有些情况是 SPA 切换，没有 navigation 事件；再检查选择页是否消失
  const stillPicker = await isShopPickerVisible(page);
  if (stillPicker) {
    // 再点一次兜底
    await hit.item.locator.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  return {
    picked: true,
    name: hit.item.name,
    preferred: hit.preferred,
    availableNames
  };
}

module.exports = {
  DEFAULT_ACCOUNTS_FILE,
  loadPreferredShopNames,
  isShopPickerVisible,
  readShopItems,
  pickShopByPreference,
  selectShopIfPicker
};
