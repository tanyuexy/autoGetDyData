const { waitVisible, setTextLikeInput } = require("./dom");
const MAX_HASHTAGS = 5;

function splitDescription(text) {
  const hashtags = [];
  const matches = text.match(/#([^\s#]+)/g);

  if (matches) {
    for (const m of matches) {
      const tag = m.slice(1).trim();
      if (tag && !hashtags.includes(tag)) {
        hashtags.push(tag);
      }
    }
  }

  let body = text
    .replace(/#([^\s#]+)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!body) {
    body = text.trim();
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

async function clickMatchingTopic(page, topic) {
  return await page.evaluate((t) => {
    const panel = document.querySelector('[class*="mention-suggest"], [class*="suggest"], [role="listbox"]');
    if (!panel || getComputedStyle(panel).display === 'none') return false;

    const items = panel.querySelectorAll('[class*="tag-hash"], [role="option"], li, div');
    for (const item of items) {
      const nameEl = item.querySelector('[class*="tag-hash-view-name"]');
      const text = (nameEl?.textContent || item.textContent || "").replace(/^#/, "").trim();
      if (text === t) {
        item.scrollIntoView({ block: 'nearest' });
        try { item.click(); } catch {}
        return true;
      }
    }
    return false;
  }, topic);
}

async function focusEditorEnd(editor) {
  await editor.click();
  await editor.evaluate((el) => {
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }).catch(async () => {
    await editor.press(process.platform === "darwin" ? "Meta+End" : "Control+End").catch(() => {});
  });
}

async function undoLastPlainTopicInput(page) {
  await page.keyboard.press("Meta+Z").catch(async () => {
    await page.keyboard.press("Control+Z").catch(() => {});
  });
  await page.waitForTimeout(300);
}

async function waitTopicRecognized(page, topic, timeout = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const recognized = await page.evaluate((t) => {
      const preview = document.querySelector("#phoneText");
      if (!preview) return false;
      const expected = `#${t}`;
      return Array.from(preview.querySelectorAll("span")).some((el) => {
        const text = (el.textContent || "").trim();
        const fontWeight = String(el.style.fontWeight || "");
        return text === expected && (fontWeight === "bold" || Number(fontWeight) >= 600);
      });
    }, topic).catch(() => false);
    if (recognized) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function clickAddTopicButton(page) {
  const addBtn = page.locator('.toolbar-button-spPS4r, span, button').filter({ hasText: "添加话题" }).first();
  if (!(await addBtn.isVisible({ timeout: 1000 }).catch(() => false))) {
    return false;
  }
  await addBtn.click();
  await page.waitForTimeout(500);
  return true;
}

async function typeTopicAndConfirmBySpace(page, editor, topic) {
  await focusEditorEnd(editor);
  await page.waitForTimeout(300);
  await page.keyboard.type(` #${topic}`);
  await page.waitForTimeout(500);
  await page.keyboard.press("Space");
  await page.waitForTimeout(900);

  if (await waitTopicRecognized(page, topic)) {
    return true;
  }

  if (await clickMatchingTopic(page, topic)) {
    await page.waitForTimeout(500);
    if (await waitTopicRecognized(page, topic)) {
      await focusEditorEnd(editor);
      await page.keyboard.press("Space");
      return true;
    }
  }

  return false;
}

async function typeTopicFromAddButton(page, editor, topic) {
  await focusEditorEnd(editor);
  if (!(await clickAddTopicButton(page))) {
    return false;
  }
  await page.keyboard.type(topic);
  await page.waitForTimeout(500);
  await page.keyboard.press("Space");
  await page.waitForTimeout(900);
  if (await waitTopicRecognized(page, topic)) {
    return true;
  }
  if (await clickMatchingTopic(page, topic)) {
    await page.waitForTimeout(500);
    return await waitTopicRecognized(page, topic);
  }
  return false;
}

async function addHashtags(page, topics) {
  const editor = await getEditor(page);
  let successCount = 0;

  for (let i = 0; i < topics.length; i += 1) {
    const topic = topics[i];
    console.log(`  [话题 ${i + 1}/${topics.length}] #${topic}`);

    if (await typeTopicAndConfirmBySpace(page, editor, topic)) {
      console.log(`    ✓ 已添加话题: #${topic}`);
      successCount++;
      continue;
    }

    await undoLastPlainTopicInput(page);
    console.log(`    ↻ 话题 #${topic} 未被平台识别，清理后重试`);

    if (await typeTopicFromAddButton(page, editor, topic)) {
      console.log(`    ✓ 已重试添加话题: #${topic}`);
      successCount++;
      continue;
    }

    await undoLastPlainTopicInput(page);
    console.log(`    ⚠ 话题 #${topic} 添加失败`);
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
  const { body, hashtags } = splitDescription(descText);
  console.log(`正文拆分完成: 正文长度 ${body.length}，识别到话题 ${hashtags.length} 个`);

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
};
