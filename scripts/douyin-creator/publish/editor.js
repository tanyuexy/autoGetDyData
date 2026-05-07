const { waitVisible, setTextLikeInput } = require("./dom");

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

async function clickMatchingTopic(page, topic) {
  return await page.evaluate((t) => {
    const panel = document.querySelector('[class*="mention-suggest"]');
    if (!panel || getComputedStyle(panel).display === 'none') return false;

    const hashItems = panel.querySelectorAll('[class*="tag-hash"]');
    for (const item of hashItems) {
      const nameEl = item.querySelector('[class*="tag-hash-view-name"]');
      if (!nameEl) continue;
      if (nameEl.textContent.trim() === t) {
        item.scrollIntoView({ block: 'nearest' });
        try { item.click(); } catch {}
        return true;
      }
    }
    return false;
  }, topic);
}

async function addHashtags(page, topics) {
  const editor = await getEditor(page);
  let successCount = 0;

  for (let i = 0; i < topics.length; i += 1) {
    const topic = topics[i];
    console.log(`  [话题 ${i + 1}/${topics.length}] #${topic}`);

    await editor.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(`#${topic}`);
    await page.waitForTimeout(1500);

    const clicked = await clickMatchingTopic(page, topic);
    if (clicked) {
      console.log(`    ✓ 已添加话题: #${topic}`);
      successCount++;
      continue;
    }

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

async function fillTitleAndDescription(page, title, description) {
  const titleInput = await waitVisible(page, [
    'input[placeholder*="标题"]',
    'input[placeholder*="作品标题"]',
  ]);
  await setTextLikeInput(titleInput, title || "");

  const descText = description || "";
  const { body, hashtags } = splitDescription(descText);

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
    console.log(`准备添加 ${hashtags.length} 个话题标签: ${hashtags.join(", ")}`);
    await addHashtags(page, hashtags);
  }
}

module.exports = {
  fillTitleAndDescription,
};
