const { step, info } = require("./logger");
const { scaledMs, closeCreatorGuides } = require("./runtime");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function dismissBlockingPortals(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(scaledMs(250));

  const datePicker = page.locator('.semi-portal [class*="datepicker"], .semi-portal .semi-datepicker').first();
  if (await datePicker.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active && typeof active.blur === "function") active.blur();
      for (const picker of document.querySelectorAll('.semi-portal [class*="datepicker"], .semi-portal .semi-datepicker')) {
        const portal = picker.closest(".semi-portal");
        if (portal) portal.style.pointerEvents = "none";
      }
    }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function clickEvenIfCovered(locator, label) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ timeout: 5000 }).catch(async (error) => {
    const message = String(error?.message || error || "");
    if (!/intercepts pointer events|Timeout/i.test(message)) throw error;
    console.log(`  ${label} 被浮层遮挡，改用 DOM 点击`);
    const clicked = await locator
      .evaluate((node) => {
        const target = node.closest("button, [role='button'], .semi-select") || node;
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      })
      .catch(() => false);
    if (!clicked) throw error;
  });
}

async function getVisibleOptionTexts(page) {
  const options = page.locator('[role="option"], .semi-select-option');
  const count = await options.count().catch(() => 0);
  const texts = [];
  for (let i = 0; i < count; i += 1) {
    const option = options.nth(i);
    if (!(await option.isVisible().catch(() => false))) continue;
    const text = cleanText(await option.textContent().catch(() => ""));
    if (text) texts.push(text);
  }
  return Array.from(new Set(texts));
}

async function selectCartOption(page) {
  const started = Date.now();
  while (Date.now() - started < scaledMs(8000)) {
    const portalOptions = page
      .locator('.semi-portal [role="option"], .semi-portal .semi-select-option')
      .filter({ hasText: "购物车" })
      .first();
    const cartOpt = (await portalOptions.isVisible({ timeout: 500 }).catch(() => false))
      ? portalOptions
      : page.locator('[role="option"], .semi-select-option').filter({ hasText: "购物车" }).first();
    if (await cartOpt.isVisible({ timeout: 500 }).catch(() => false)) {
      await clickEvenIfCovered(cartOpt, "购物车选项");
      await page.waitForTimeout(scaledMs(1000));
      step("已选择购物车");
      return;
    }
    await page.waitForTimeout(scaledMs(300));
  }

  const texts = await getVisibleOptionTexts(page);
  throw new Error(`未找到购物车选项；当前可见选项: ${texts.join(" / ") || "(空)"}`);
}

async function waitForCoverRecommendationSettled(_page, _timeoutMs = 45000) {
  // 「AI 智能推荐封面生成中」不参与阻塞，挂车步骤无需等待
}

async function isCartUiVisible(page) {
  const anchor = page.locator("#douyin_creator_pc_anchor_jump").first();
  const checks = [
    anchor.locator('[class*="cart-part"]').first(),
    anchor.locator('input[placeholder*="粘贴商品"], input[placeholder*="链接"]').first(),
    page.locator('.semi-select-selection-text:has-text("购物车")').first(),
  ];
  for (const locator of checks) {
    if (await locator.isVisible({ timeout: 300 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function waitForCartUi(page, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < scaledMs(timeoutMs)) {
    if (await isCartUiVisible(page)) return;
    await page.waitForTimeout(scaledMs(300));
  }
  throw new Error("选择购物车后未出现挂车输入区域");
}

async function getCartLinkInput(page) {
  const anchor = page.locator("#douyin_creator_pc_anchor_jump").first();
  const linkInput = anchor
    .locator('input[placeholder*="粘贴商品"], input[placeholder*="链接"]')
    .first();
  await linkInput.waitFor({ state: "visible", timeout: scaledMs(10000) });
  return linkInput;
}

async function fillCartLinkInput(page, linkInput, productLink) {
  await linkInput.fill(productLink);
  await linkInput
    .evaluate((el) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
    })
    .catch(() => {});

  const actual = cleanText(await linkInput.inputValue().catch(() => ""));
  if (actual !== cleanText(productLink)) {
    throw new Error(`商品链接填写校验失败：期望 "${productLink}"，实际 "${actual || "(空)"}"`);
  }
  step("链接已填入");
}

async function isAddLinkDisabled(locator) {
  return locator
    .evaluate((el) => {
      const cls = String(el.className || "");
      return (
        el.classList.contains("disabled") ||
        /disable/i.test(cls) ||
        el.getAttribute("aria-disabled") === "true"
      );
    })
    .catch(() => true);
}

async function clickAddLinkButton(page, tagSection) {
  const anchor = page.locator("#douyin_creator_pc_anchor_jump").first();
  const addBtn = anchor.locator('span:has-text("添加链接"), button:has-text("添加链接")').first();
  const targetAddBtn = (await addBtn.isVisible().catch(() => false))
    ? addBtn
    : tagSection.locator('span:has-text("添加链接"), button:has-text("添加链接")').first();

  if (!(await targetAddBtn.isVisible().catch(() => false))) {
    throw new Error("未找到添加链接按钮");
  }

  const started = Date.now();
  while (Date.now() - started < scaledMs(8000)) {
    if (!(await isAddLinkDisabled(targetAddBtn))) break;
    await page.waitForTimeout(scaledMs(300));
  }
  if (await isAddLinkDisabled(targetAddBtn)) {
    throw new Error("添加链接按钮仍不可用，请检查商品链接是否有效");
  }

  await clickEvenIfCovered(targetAddBtn, "添加链接按钮");
}

async function readBlockingMessage(page) {
  const limitModal = page.locator('.semi-modal-content').filter({ hasText: '无法添加购物车' }).first();
  if (await limitModal.isVisible().catch(() => false)) {
    const limitMsg = await limitModal.locator('[class*="modal-message"]').first().textContent().catch(() => "已达到限额");
    return `购物车限额: ${cleanText(limitMsg)}`;
  }

  const toast = page.locator('.semi-toast-content, .semi-message, [class*="toast"], [class*="message"]').last();
  if (await toast.isVisible({ timeout: 300 }).catch(() => false)) {
    const text = cleanText(await toast.textContent().catch(() => ""));
    if (/失败|错误|无法|不支持|不可|超出|限额/.test(text)) {
      return text;
    }
  }

  return "";
}

async function isProductAdded(page) {
  const selectors = [
    '[class*="cart-item"]',
    '[class*="cart-container"] [class*="item"]',
    '[class*="anchor"] [class*="card"]',
    'text=已添加商品',
  ];
  for (const selector of selectors) {
    if (await page.locator(selector).first().isVisible({ timeout: 300 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function waitForProductLinkResult(page) {
  const editModal = page.locator('.semi-modal-content').filter({ hasText: '完成编辑' }).first();
  const started = Date.now();
  while (Date.now() - started < scaledMs(15000)) {
    const blockingMessage = await readBlockingMessage(page);
    if (blockingMessage) throw new Error(blockingMessage);
    if (await editModal.isVisible().catch(() => false)) return "edit-modal";
    if (await isProductAdded(page)) return "product-added";
    await page.waitForTimeout(scaledMs(500));
  }
  throw new Error("添加商品链接超时：未出现编辑弹窗或已添加商品卡片");
}

async function getAddTagSection(page) {
  const byHeading = page
    .locator('xpath=//*[normalize-space()="添加标签"]/ancestor::*[.//*[contains(@class,"semi-select")] or .//input][1]')
    .first();
  if (await byHeading.isVisible({ timeout: 1000 }).catch(() => false)) {
    return byHeading;
  }
  return page.locator('section:has-text("添加标签"), #douyin_creator_pc_anchor_jump').first();
}

async function fillProductEditModal(page, productTitle, approvalNumber) {
  const editModal = page.locator('.semi-modal-content').filter({ hasText: '完成编辑' }).first();
  await editModal.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(scaledMs(500));

  if (!(await editModal.isVisible().catch(() => false))) {
    info("无弹窗，链接可能已直接添加");
    return;
  }

  step("商品编辑弹窗已打开");
  const modalContent = await editModal.evaluate((m) => ({
    text: m.textContent.trim().slice(0, 500),
    inputs: Array.from(m.querySelectorAll('input')).map((i) => ({ ph: i.placeholder, v: i.value })),
    buttons: Array.from(m.querySelectorAll('button, [class*="btn"]')).map((b) => b.textContent.trim().slice(0, 20)).filter(Boolean),
  })).catch(() => null);
  if (modalContent?.inputs?.length) {
    modalContent.inputs.forEach((inp) => info(`[输入框] "${inp.ph}"`));
  }

  async function findFieldByLabel(labelText, placeholderSelector) {
    const directInput = editModal.locator(placeholderSelector).first();
    if (await directInput.isVisible().catch(() => false)) return directInput;

    const byLabel = editModal
      .locator(`xpath=.//*[normalize-space()="${labelText}"]/ancestor::*[contains(@class,"semi-form-field")][1]//input`)
      .first();
    if (await byLabel.isVisible().catch(() => false)) return byLabel;

    const fallbackByText = editModal.locator(`xpath=.//*[contains(normalize-space(),"${labelText}")]/following::input[1]`).first();
    if (await fallbackByText.isVisible().catch(() => false)) return fallbackByText;

    throw new Error(`未找到${labelText}输入框`);
  }

  async function fillFieldByLabel(labelText, value, placeholderSelector) {
    const expected = cleanText(value);
    if (!expected) return;

    const input = await findFieldByLabel(labelText, placeholderSelector);
    await input.fill(expected);
    await input.evaluate((el) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
    }).catch(() => {});

    const actual = cleanText(await input.inputValue().catch(() => ""));
    if (actual !== expected) {
      throw new Error(`${labelText}填写校验失败：期望 "${expected}"，实际 "${actual || "(空)"}"`);
    }
    step(`已填写${labelText}: ${expected}`);
  }

  await fillFieldByLabel("商品短标题", productTitle, 'input[placeholder="请输入商品短标题"], input[placeholder*="短标题"]');
  await fillFieldByLabel("广审批文号", approvalNumber, 'input[placeholder*="广审"], input[placeholder*="批文"]');

  const finishBtn = editModal.locator('button:has-text("完成编辑")').first();
  if (await finishBtn.isVisible().catch(() => false)) {
    if (await finishBtn.isDisabled().catch(() => false)) {
      const modalText = cleanText(await editModal.textContent().catch(() => ""));
      throw new Error(`商品编辑提交失败：完成编辑按钮不可用 (${modalText.slice(0, 200)})`);
    }
    await finishBtn.click();
    await editModal.waitFor({ state: "hidden", timeout: scaledMs(15000) }).catch(() => {});
    if (await editModal.isVisible().catch(() => false)) {
      const modalText = cleanText(await editModal.textContent().catch(() => ""));
      throw new Error(`商品编辑提交失败：弹窗未关闭 (${modalText.slice(0, 200)})`);
    }
    step("已点击完成编辑");
  } else {
    throw new Error("未找到完成编辑按钮");
  }
}

async function selectCartAndLinkForVideo(page, productLink, productTitle, approvalNumber) {
  if (!productLink) {
    throw new Error("挂车链接为空，无法设置购物车");
  }
  step("设置购物车");

  await closeCreatorGuides(page);
  await waitForCoverRecommendationSettled(page);

  const tagSection = await getAddTagSection(page);
  const tagSelect = tagSection.locator(".semi-select").first();
  if (!(await tagSelect.isVisible().catch(() => false))) {
    throw new Error("未找到购物车下拉框");
  }

  await dismissBlockingPortals(page);
  await clickEvenIfCovered(tagSelect, "购物车下拉框");
  await selectCartOption(page);
  await waitForCartUi(page);

  const linkInput = await getCartLinkInput(page);
  await fillCartLinkInput(page, linkInput, productLink);
  await page.waitForTimeout(scaledMs(1000));

  const editModal = page.locator('.semi-modal-content').filter({ hasText: "完成编辑" }).first();
  if (await editModal.isVisible().catch(() => false)) {
    console.log("  商品编辑弹窗已自动打开");
  } else {
    await clickAddLinkButton(page, tagSection);
  }

  await waitForProductLinkResult(page);
  if (await editModal.isVisible().catch(() => false)) {
    await fillProductEditModal(page, productTitle, approvalNumber);
  }
}

async function selectCartAndLinkForArticle(page, productLink, productTitle, approvalNumber) {
  if (!productLink) {
    throw new Error("挂车链接为空，无法设置购物车");
  }
  step("设置购物车");

  await closeCreatorGuides(page);

  const anchor = page.locator("#douyin_creator_pc_anchor_jump");
  const cartSelect = anchor.locator(".semi-select").first();
  const tagSection = await getAddTagSection(page);
  const tagSelect = tagSection.locator(".semi-select").first();
  const select = (await cartSelect.isVisible().catch(() => false)) ? cartSelect : tagSelect;

  if (!(await select.isVisible().catch(() => false))) {
    throw new Error("未找到购物车下拉框");
  }

  await dismissBlockingPortals(page);
  await clickEvenIfCovered(select, "购物车下拉框");
  await selectCartOption(page);
  await waitForCartUi(page);

  const linkInput = await getCartLinkInput(page);
  await fillCartLinkInput(page, linkInput, productLink);
  await page.waitForTimeout(scaledMs(1000));

  await clickAddLinkButton(page, tagSection);
  await waitForProductLinkResult(page);

  await fillProductEditModal(page, productTitle, approvalNumber);
}

module.exports = {
  selectCartAndLinkForVideo,
  selectCartAndLinkForArticle,
};
