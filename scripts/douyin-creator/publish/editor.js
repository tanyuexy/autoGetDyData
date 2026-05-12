const { waitVisible, setTextLikeInput } = require("./dom");
const MAX_HASHTAGS = 5;
const MAX_RECOGNIZED_HASHTAG_LENGTH = 10;
const MENTION_SUGGEST_SELECTOR = '.mention-suggest-mount-dom, [class*="mention-suggest"], [role="listbox"]';

function cleanHashtag(tag) {
  return String(tag || "").replace(/\s+/g, "").trim();
}

function getHashtagLength(tag) {
  return Array.from(tag).length;
}

function splitDescription(text) {
  const hashtags = [];
  const plainHashtags = [];

  let body = text
    .replace(/#([^\s#]+)/g, (matched, rawTag) => {
      const tag = cleanHashtag(rawTag);
      if (!tag) return "";

      if (getHashtagLength(tag) > MAX_RECOGNIZED_HASHTAG_LENGTH) {
        if (!plainHashtags.includes(tag)) {
          plainHashtags.push(tag);
        }
        return rawTag.trim();
      }

      if (!hashtags.includes(tag)) {
        hashtags.push(tag);
      }
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!body && hashtags.length === 0 && plainHashtags.length === 0) {
    body = text.trim();
  }

  return { body, hashtags, plainHashtags };
}

async function getEditor(page) {
  const editor = page.locator('.editor-kit-container[contenteditable="true"]').first();
  if (await editor.isVisible({ timeout: 2000 }).catch(() => false)) return editor;

  const fallback = page.locator('[contenteditable="true"]').first();
  if (await fallback.isVisible({ timeout: 2000 }).catch(() => false)) return fallback;

  throw new Error("找不到描述编辑器");
}

async function focusEditorEnd(editor) {
  await editor.click();
  const endKeys =
    process.platform === "darwin"
      ? ["Meta+ArrowDown", "Meta+End", "Control+End"]
      : ["Control+End", "End"];
  for (const key of endKeys) {
    await editor.press(key).catch(() => {});
    await editor.page().waitForTimeout(100);
  }
}

async function closeMentionSuggest(page) {
  const panel = page.locator(MENTION_SUGGEST_SELECTOR).first();
  if (!(await panel.isVisible({ timeout: 300 }).catch(() => false))) {
    return;
  }

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
  if (await panel.isVisible({ timeout: 300 }).catch(() => false)) {
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(200);
  }
}

async function typeTopicAndConfirmBySpace(page, editor, topic, isFirstTopic) {
  await focusEditorEnd(editor);
  await page.waitForTimeout(300);
  await page.keyboard.type(`${isFirstTopic ? "" : " "}#${topic}`);
  await page.waitForTimeout(500);
  await page.keyboard.press("Space");
  await page.waitForTimeout(500);
  await closeMentionSuggest(page);
}

async function insertTopicSectionBreak(page, editor, body) {
  if (!body) return;
  await focusEditorEnd(editor);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
}

async function addHashtags(page, topics) {
  const editor = await getEditor(page);
  let successCount = 0;

  for (let i = 0; i < topics.length; i += 1) {
    const topic = topics[i];
    console.log(`  [话题 ${i + 1}/${topics.length}] #${topic}`);

    await typeTopicAndConfirmBySpace(page, editor, topic, i === 0);
    console.log(`    ✓ 已输入话题并按空格: #${topic}`);
    successCount++;
  }

  console.log(`话题添加完成: ${successCount}/${topics.length}`);
}

async function fillTitleAndDescription(page, title, description) {
  const titleInput = await waitVisible(page, [
    'input[placeholder*="标题"]',
    'input[placeholder*="作品标题"]',
  ]);
  await setTextLikeInput(titleInput, title || "");

  const descText = description || "";
  const { body, hashtags, plainHashtags } = splitDescription(descText);
  console.log(`正文拆分完成: 正文长度 ${body.length}，识别到可自动话题化标签 ${hashtags.length} 个`);
  if (plainHashtags.length > 0) {
    console.log(
      `以下话题超过 ${MAX_RECOGNIZED_HASHTAG_LENGTH} 个字，已去掉 # 后保留为正文: ${plainHashtags.map((tag) => `#${tag}`).join(", ")}`
    );
  }

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

  await setTextLikeInput(editor, body);
  if (hashtags.length > 0) {
    await insertTopicSectionBreak(page, editor, body);
  }
  console.log("已填写标题与正文");
  await page.waitForTimeout(500);

  if (hashtags.length > 0) {
    const limitedHashtags = hashtags.slice(0, MAX_HASHTAGS);
    if (hashtags.length > MAX_HASHTAGS) {
      console.log(
        `话题标签共 ${hashtags.length} 个，平台最多添加 ${MAX_HASHTAGS} 个，已跳过后续 ${hashtags.length - MAX_HASHTAGS} 个`
      );
    }
    console.log(`准备添加 ${limitedHashtags.length} 个话题标签: ${limitedHashtags.join(", ")}`);
    await addHashtags(page, limitedHashtags);
  }
}

module.exports = {
  fillTitleAndDescription,
  splitDescription,
};
