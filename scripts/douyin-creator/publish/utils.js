const path = require("path");
const { ensureDir } = require("../lib/fs-utils");
const {
  isLoggedInAtTarget,
  notifyLoginRequired,
  waitForManualLoginFlow,
} = require("../lib/login");
const { saveAuth } = require("../lib/exporter");
const { TARGET_URL } = require("../lib/env");

const MATERIALS_DIR = path.resolve(
  process.env.CREATOR_MATERIALS_DIR ||
    path.join(process.cwd(), "storage/creator-materials")
);
const PUBLISH_DEBUG_DIR = path.resolve(
  process.env.CREATOR_PUBLISH_DEBUG_DIR ||
    path.join(process.cwd(), "storage/creator-publish-debug")
);
const ARTICLE_POST_URL =
  "https://creator.douyin.com/creator-micro/content/post/image?default-tab=3&enter_from=publish_page&media_type=image&type=new";
const VIDEO_POST_URL =
  "https://creator.douyin.com/creator-micro/content/post/video";

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      i += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

async function saveDebugArtifacts(page, accountName, tag) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeAccount = String(accountName || "unknown").replace(/[\\/:*?"<>|]/g, "_");
  const dir = path.join(PUBLISH_DEBUG_DIR, safeAccount);
  await ensureDir(dir);

  const htmlPath = path.join(dir, `${stamp}-${tag}.html`);
  const screenshotPath = path.join(dir, `${stamp}-${tag}.png`);

  try {
    const html = await page.content();
    require("fs").writeFileSync(htmlPath, html, "utf-8");
  } catch {}

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch {}

  console.log(`已保存调试文件: ${htmlPath}`);
  console.log(`已保存调试截图: ${screenshotPath}`);
}

async function waitVisible(page, selectors, timeout = 15000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const started = Date.now();
  while (Date.now() - started < timeout) {
    for (const selector of list) {
      const loc = page.locator(selector).first();
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`未找到元素: ${list.join(" | ")}`);
}

async function setTextLikeInput(locator, value) {
  await locator.click();
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "input" || tag === "textarea") {
    await locator.fill(value);
    return;
  }
  const nestedInput = locator.locator("input, textarea").first();
  if (await nestedInput.isVisible().catch(() => false)) {
    await nestedInput.fill(value);
    return;
  }
  await locator.fill(value).catch(async () => {
    await locator.press("Meta+A").catch(() => {});
    await locator.type(value);
  });
}

function splitDescription(text) {
  const parts = text.split(/\n{2,}/);
  let body = text;
  const hashtags = [];

  if (parts.length > 1) {
    body = parts.slice(0, -1).join("\n\n");
    const tagLine = parts[parts.length - 1];
    const matches = tagLine.match(/#([^\s#]+)/g);
    if (matches) {
      for (const m of matches) {
        const tag = m.slice(1);
        if (tag && !hashtags.includes(tag)) {
          hashtags.push(tag);
        }
      }
    }
  }

  return { body, hashtags };
}

async function getEditor(page) {
  const editor = page.locator('.editor-kit-container[contenteditable="true"]').first();
  if (await editor.isVisible({ timeout: 2000 }).catch(() => false)) return editor;

  const fallback = page.locator('[contenteditable="true"]').first();
  if (await fallback.isVisible({ timeout: 2000 }).catch(() => false)) return fallback;

  throw new Error("找不到描述编辑器");
}

async function addHashtags(page, topics) {
  const editor = await getEditor(page);
  let successCount = 0;

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    console.log(`  [话题 ${i + 1}/${topics.length}] #${topic}`);

    await editor.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(`#${topic}`);
    await page.waitForTimeout(1500);

    // 在建议面板中精确匹配话题名称
    const clicked = await clickMatchingTopic(page, topic);
    if (clicked) {
      console.log(`    ✓ 已添加话题: #${topic}`);
      successCount++;
      continue;
    }

    // 备用：点击 #添加话题 按钮打开话题面板
    const addBtn = page.locator('.toolbar-button-spPS4r', { hasText: "添加话题" }).first();
    if (await addBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(1500);

      if (await clickMatchingTopic(page, topic)) {
        console.log(`    ✓ 已从面板添加话题: #${topic}`);
        successCount++;
        continue;
      }

      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    console.log(`    ⚠ 话题 #${topic} 添加失败`);
  }

  console.log(`话题添加完成: ${successCount}/${topics.length}`);
}

/**
 * 在可见的话题建议面板中点击精确匹配的话题项
 * 返回 true 表示点击成功
 */
async function clickMatchingTopic(page, topic) {
  // .mention-suggest 面板 > .tag-hash 容器 > .tag-hash-view-name (精确话题名)
  return await page.evaluate((t) => {
    const panel = document.querySelector('[class*="mention-suggest"]');
    if (!panel || getComputedStyle(panel).display === 'none') return false;

    // 找到所有 tag-hash 项
    const hashItems = panel.querySelectorAll('[class*="tag-hash"]');
    for (const item of hashItems) {
      const nameEl = item.querySelector('[class*="tag-hash-view-name"]');
      if (!nameEl) continue;
      if (nameEl.textContent.trim() === t) {
        // 精确匹配 → 滚动到可见再点
        item.scrollIntoView({ block: 'nearest' });
        try { item.click(); } catch {}
        return true;
      }
    }
    return false;
  }, topic);
}

async function fillTitleAndDescription(page, title, description) {
  const titleInput = await waitVisible(page, [
    'input[placeholder*="标题"]',
    'input[placeholder*="作品标题"]',
  ]);
  await setTextLikeInput(titleInput, title || "");

  // 解析描述：分离正文和话题标签
  const descText = description || "";
  const { body, hashtags } = splitDescription(descText);

  // 找到编辑器
  let editor;
  const editorSel = page.locator('.editor-kit-container[contenteditable="true"]').first();
  if (await editorSel.isVisible({ timeout: 2000 }).catch(() => false)) {
    editor = editorSel;
  } else {
    editor = await waitVisible(page, [
      '[data-placeholder*="描述"]',
      '[contenteditable="true"]',
      'textarea[placeholder*="描述"]',
    ]);
  }

  // 填写正文
  await setTextLikeInput(editor, body);
  console.log("已填写标题与正文");
  await page.waitForTimeout(500);

  // 逐个添加话题标签（带 # 号）
  if (hashtags.length > 0) {
    console.log(`准备添加 ${hashtags.length} 个话题标签: ${hashtags.join(", ")}`);
    await addHashtags(page, hashtags);
  }
}

async function selectSelfDeclaration(page, isAiContent) {
  console.log(`设置自主声明... (参数 isAiContent=${JSON.stringify(isAiContent)})`);
  const targetLabel = isAiContent ? "内容由AI生成" : "无需添加自主声明";

  const section = page.locator('section:has(.title-cnbkZe:has-text("自主声明"))').first();
  const selectBox = section.locator('[class*="selectBox"]').first();

  if (!(await selectBox.isVisible().catch(() => false))) {
    console.log("未找到自主声明下拉框，跳过");
    return;
  }

  const currentText = await selectBox.locator('[class*="selectText"]').first().textContent().catch(() => "");
  if (currentText.includes(targetLabel)) {
    console.log(`自主声明已是: ${targetLabel}`);
    return;
  }

  await selectBox.click();
  await page.waitForTimeout(1500);

  const targetOption = page.locator(`label:has-text("${targetLabel}")`).first();
  if (await targetOption.isVisible().catch(() => false)) {
    await targetOption.click();
    await page.waitForTimeout(500);
    console.log(`已选择: ${targetLabel}`);
  } else {
    console.log(`未找到选项: ${targetLabel}`);
  }

  const confirmBtn = page.locator('.semi-modal-content button:has-text("确定")').first();
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click();
    await page.waitForTimeout(1000);
    console.log("已确定关闭自主声明弹窗");
  }
}

async function setScheduleIfNeeded(page, scheduleAt) {
  if (!scheduleAt) return;

  const scheduleToggle = await waitVisible(page, [
    'label:has-text("定时发布")',
    'text=定时发布',
  ]);
  await scheduleToggle.click();

  const inputWrap = await waitVisible(page, [
    '.date-picker-x1Ag_4 .semi-input-wrapper',
    '.semi-datepicker-input .semi-input-wrapper',
    '.semi-datepicker input',
  ]);
  await inputWrap.click();

  const input = await waitVisible(page, [
    '.semi-datepicker input',
    'input[placeholder*="日期"]',
    'input[placeholder*="时间"]',
  ]);

  const d = new Date(scheduleAt);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`无效的定时发布时间: ${scheduleAt}`);
  }
  const pad = (n) => String(n).padStart(2, "0");
  const text = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  await setTextLikeInput(input, text);
  await input.press("Enter").catch(() => {});
  console.log(`已设置定时发布时间: ${text}`);
}

async function ensureLoggedIn(page, accountName, paths) {
  console.log(`检查账号 [${accountName}] 登录状态...`);
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // 已登录直接返回
  if (await isLoggedInAtTarget(page)) {
    console.log(`账号 [${accountName}] 登录态有效`);
    return;
  }

  // 未登录 → 触发完整登录流程
  const reason = "cookies/storageState 失效或已过期";
  console.log(`账号 [${accountName}] ${reason}，进入登录流程`);
  await notifyLoginRequired(page, paths, accountName, reason);
  await waitForManualLoginFlow(page, paths, accountName, reason);

  // 登录完成后等待页面稳定
  console.log(`账号 [${accountName}] 登录流程完成，验证状态...`);
  await page.goto(TARGET_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  // 最多重试 3 次验证
  for (let i = 0; i < 3; i++) {
    if (await isLoggedInAtTarget(page)) break;
    console.log(`  验证未通过，等待渲染... (${i + 1}/3)`);
    await page.waitForTimeout(3000);
  }

  if (!(await isLoggedInAtTarget(page))) {
    throw new Error(`账号 ${accountName} 登录验证未通过`);
  }

  // 保存登录态
  await saveAuth(page.context(), paths, accountName);
  console.log(`账号 [${accountName}] 登录态已保存`);
}

async function clickPublishButton(page) {
  console.log("点击发布按钮...");

  // 查找主发布按钮（排除定时发布等）
  const publishBtn = page.locator([
    'button.primary-cECiOJ:has-text("发布")',
    'button.fixed-J9O8Yw:has-text("发布")',
    'button:has-text("发布"):not(:has-text("定时")):not(:has-text("高清"))',
  ].join(", ")).first();

  if (!(await publishBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log("  ⚠️ 未找到发布按钮，可能已自动发布或按钮被遮挡");
    return false;
  }

  // 检查按钮是否被禁用
  const isDisabled = await publishBtn.isDisabled().catch(() => false);
  if (isDisabled) {
    console.log("  ⚠️ 发布按钮处于禁用状态，可能必填字段未填写完成");
    return false;
  }

  await publishBtn.click();
  console.log("  ✓ 已点击发布按钮");

  // 等待发布结果：最多等待30秒
  await page.waitForTimeout(3000);

  // 检测发布成功或失败
  const toastSelector = '.semi-toast-content, .semi-message, [class*="toast"], [class*="message"]';
  try {
    // 等待任何提示出现
    const toast = await page.waitForSelector(toastSelector, { timeout: 25000 }).catch(() => null);
    if (toast) {
      const toastText = await toast.textContent().catch(() => "");
      console.log(`  提示信息: ${toastText.slice(0, 100)}`);
      if (toastText.includes("发布成功") || toastText.includes("success")) {
        console.log("  ✅ 发布成功");
        return true;
      }
      if (toastText.includes("失败") || toastText.includes("错误") || toastText.includes("违规")) {
        throw new Error(`发布失败: ${toastText.slice(0, 200)}`);
      }
    }
  } catch (e) {
    if (e.message.startsWith("发布失败")) throw e;
    // Timeout or other error - the toast might not have appeared
  }

  // 检查按钮是否消失（点击后变为不可见，说明正在处理）
  const stillVisible = await publishBtn.isVisible().catch(() => false);
  if (stillVisible) {
    console.log("  ⚠️ 发布按钮仍在，可能发布未完成");
    return false;
  }

  console.log("  ✅ 发布已提交（按钮已隐藏）");
  return true;
}

module.exports = {
  MATERIALS_DIR,
  PUBLISH_DEBUG_DIR,
  ARTICLE_POST_URL,
  VIDEO_POST_URL,
  parseArgs,
  saveDebugArtifacts,
  waitVisible,
  setTextLikeInput,
  fillTitleAndDescription,
  selectSelfDeclaration,
  setScheduleIfNeeded,
  ensureLoggedIn,
  clickPublishButton,
};
