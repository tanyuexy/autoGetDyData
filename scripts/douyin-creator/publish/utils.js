const path = require("path");
const { ensureDir } = require("../lib/fs-utils");

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

async function fillTitleAndDescription(page, title, description) {
  const titleInput = await waitVisible(page, [
    'input[placeholder*="标题"]',
    'input[placeholder*="作品标题"]',
  ]);
  await setTextLikeInput(titleInput, title || "");

  const descInput = await waitVisible(page, [
    '[data-placeholder*="描述"]',
    '[contenteditable="true"]',
    'textarea[placeholder*="描述"]',
  ]);

  await setTextLikeInput(descInput, description || "");
  console.log("已填写标题与作品描述");
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

async function ensureLoggedIn(page, accountName) {
  const loginBtn = page.locator('text=登录, text=扫码登录').first();
  if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    throw new Error(`账号 ${accountName} 登录态失效，需要重新登录`);
  }
  console.log(`账号 [${accountName}] 登录态有效`);
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
};
