const { waitVisible, setTextLikeInput } = require("./dom");
const { step, info } = require("./logger");
const MAX_HASHTAGS = 5;
const MAX_RECOGNIZED_HASHTAG_LENGTH = 10;
const MENTION_SUGGEST_SELECTOR = '.mention-suggest-mount-dom, [class*="mention-suggest"], [role="listbox"]';

function cleanHashtag(tag) {
  return String(tag || "").replace(/\s+/g, "").trim();
}

function normalizeTopicText(text) {
  return cleanHashtag(String(text || "").replace(/^#/, ""));
}

function getHashtagLength(tag) {
  return Array.from(tag).length;
}

/** 去掉 # 与标签名之间的空白，便于识别 `# 好物` 这类写法 */
function stripSpacesAfterHash(text) {
  return String(text || "").replace(/#(\s+)/g, "#");
}

function splitDescription(text) {
  const hashtags = [];
  const plainHashtags = [];

  let body = stripSpacesAfterHash(text)
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
    .replace(/(^|\s)#(?=\s|$)/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!body && hashtags.length === 0 && plainHashtags.length === 0) {
    body = text.trim();
  }

  return { body, hashtags, plainHashtags };
}

function normalizeDescriptionForPublish(text) {
  const { body, hashtags, plainHashtags } = splitDescription(text);
  const topicText = hashtags.map((tag) => `#${tag}`).join(" ");
  const normalizedText = [body, topicText].filter(Boolean).join("\n\n");
  return { body, hashtags, plainHashtags, normalizedText };
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
  await editor.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }).catch(() => {});
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

async function getRecognizedTopicTexts(page) {
  const topicEls = page.locator('[data-mention="#"] span, [class*="topic"], [class*="hashtag"]');
  const topicCount = await topicEls.count().catch(() => 0);
  const topicTexts = [];
  for (let i = 0; i < topicCount; i += 1) {
    const text = (await topicEls.nth(i).textContent().catch(() => "")).trim();
    if (text) topicTexts.push(text);
  }
  return topicTexts;
}

function topicTextMatches(actualText, expectedTopic) {
  const actual = normalizeTopicText(actualText);
  const expected = normalizeTopicText(expectedTopic);
  if (!actual || !expected) return false;
  return actual === expected;
}

async function waitForTopicRecognized(page, topic, timeout = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const topicTexts = await getRecognizedTopicTexts(page);
    if (topicTexts.some((text) => topicTextMatches(text, topic))) {
      return true;
    }
    await page.waitForTimeout(200);
  }
  return false;
}

async function confirmPendingTopic(page, topic) {
  const confirmKeys = ["Space", "Enter", "Tab"];
  for (const key of confirmKeys) {
    await page.keyboard.press(key).catch(() => {});
    if (await waitForTopicRecognized(page, topic, 1200)) {
      return true;
    }
  }
  return false;
}

async function typeTopicDirectly(page, editor, topic, isFirstTopic) {
  await focusEditorEnd(editor);
  await page.waitForTimeout(300);
  await page.keyboard.type(`${isFirstTopic ? "" : " "}#${topic}`);
  await page.waitForTimeout(500);
  return confirmPendingTopic(page, topic);
}

async function typeTopicFromToolbar(page, editor, topic) {
  const button = page.locator('.toolbar-button-spPS4r:has-text("#添加话题"), text="#添加话题"').first();
  if (!(await button.isVisible({ timeout: 800 }).catch(() => false))) {
    return false;
  }

  await button.click().catch(() => {});
  await page.waitForTimeout(300);
  await page.keyboard.type(topic);
  if (await confirmPendingTopic(page, topic)) {
    return true;
  }

  await focusEditorEnd(editor);
  await page.keyboard.type(` #${topic}`);
  return confirmPendingTopic(page, topic);
}

async function typeTopicAndConfirm(page, editor, topic, isFirstTopic) {
  if (await waitForTopicRecognized(page, topic, 300)) {
    return true;
  }

  let recognized = await typeTopicDirectly(page, editor, topic, isFirstTopic);
  if (!recognized) {
    recognized = await typeTopicFromToolbar(page, editor, topic);
  }

  await closeMentionSuggest(page);
  return recognized || waitForTopicRecognized(page, topic, 1000);
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
    info(`话题 ${i + 1}/${topics.length}  #${topic}`);
    if (await typeTopicAndConfirm(page, editor, topic, i === 0)) {
      step(`已识别: #${topic}`);
      successCount++;
    } else {
      step(`未识别: #${topic}`);
    }
  }

  step(`话题添加完成: ${successCount}/${topics.length}`);
}

async function fillTitleAndDescription(page, title, description) {
  const titleInput = await waitVisible(page, [
    'input[placeholder*="标题"]',
    'input[placeholder*="作品标题"]',
  ]);
  await setTextLikeInput(titleInput, title || "");

  const descText = description || "";
  const { body, hashtags, plainHashtags, normalizedText } = normalizeDescriptionForPublish(descText);
  step(`正文拆分: 长度 ${body.length}，话题标签 ${hashtags.length} 个`);
  if (normalizedText !== descText.trim()) {
    info(`正文已归一化: ${normalizedText.replace(/\n+/g, " / ")}`);
  }
  if (plainHashtags.length > 0) {
    info(`超长话题已保留为正文: ${plainHashtags.map((tag) => `#${tag}`).join(", ")}`);
  }

  let editor;
  const editorSel = page.locator('.editor-kit-container[contenteditable="true"]').first();
  if (await editorSel.isVisible({ timeout: 2000 }).catch(() => false)) {
    editor = editorSel;
  } else {
    editor = await waitVisible(page, [
      '[data-placeholder*="描述"]',
      '[contenteditable="true"]',
    ]);
  }

  await setTextLikeInput(editor, body);
  if (hashtags.length > 0) {
    await insertTopicSectionBreak(page, editor, body);
  }
  step("已填写标题与正文");
  await page.waitForTimeout(500);

  if (hashtags.length > 0) {
    const limitedHashtags = hashtags.slice(0, MAX_HASHTAGS);
    if (hashtags.length > MAX_HASHTAGS) {
      info(`平台最多 ${MAX_HASHTAGS} 个话题，已跳过 ${hashtags.length - MAX_HASHTAGS} 个`);
    }
    step(`添加 ${limitedHashtags.length} 个话题: ${limitedHashtags.join(", ")}`);
    await addHashtags(page, limitedHashtags);
  }
}

module.exports = {
  fillTitleAndDescription,
  normalizeDescriptionForPublish,
  normalizeTopicText,
  splitDescription,
  topicTextMatches,
};
