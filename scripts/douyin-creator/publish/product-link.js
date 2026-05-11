async function dismissBlockingPortals(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);

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

async function fillProductEditModal(page, productTitle, approvalNumber) {
  const editModal = page.locator('.semi-modal-content').filter({ hasText: '完成编辑' }).first();
  await editModal.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  if (!(await editModal.isVisible().catch(() => false))) {
    console.log("  → 无弹窗，链接可能已直接添加");
    return;
  }

  console.log("  商品编辑弹窗已打开");
  const modalContent = await editModal.evaluate((m) => ({
    text: m.textContent.trim().slice(0, 500),
    inputs: Array.from(m.querySelectorAll('input')).map((i) => ({ ph: i.placeholder, v: i.value })),
    buttons: Array.from(m.querySelectorAll('button, [class*="btn"]')).map((b) => b.textContent.trim().slice(0, 20)).filter(Boolean),
  })).catch(() => null);
  if (modalContent?.inputs?.length) {
    modalContent.inputs.forEach((inp) => console.log(`    [输入框] "${inp.ph}"`));
  }

  async function fillFieldByLabel(labelText, value, placeholderSelector) {
    if (!value) return;

    const directInput = editModal.locator(placeholderSelector).first();
    if (await directInput.isVisible().catch(() => false)) {
      await directInput.fill(value);
      console.log(`  ✓ 已填写${labelText}: ${value}`);
      return;
    }

    const byLabel = editModal.locator(`xpath=.//*[normalize-space()="${labelText}"]/ancestor::*[contains(@class,"semi-form-field")][1]//input`).first();
    if (await byLabel.isVisible().catch(() => false)) {
      await byLabel.fill(value);
      console.log(`  ✓ 已填写${labelText}: ${value}`);
      return;
    }

    const fallbackByText = editModal.locator(`xpath=.//*[contains(normalize-space(),"${labelText}")]/following::input[1]`).first();
    if (await fallbackByText.isVisible().catch(() => false)) {
      await fallbackByText.fill(value);
      console.log(`  ✓ 已填写${labelText}: ${value}`);
      return;
    }

    console.log(`  ⚠️ 未找到${labelText}输入框`);
  }

  await fillFieldByLabel("商品短标题", productTitle, 'input[placeholder="请输入商品短标题"], input[placeholder*="短标题"]');
  await fillFieldByLabel("广审批文号", approvalNumber, 'input[placeholder*="广审"], input[placeholder*="批文"]');

  const finishBtn = editModal.locator('button:has-text("完成编辑")').first();
  if (await finishBtn.isVisible().catch(() => false)) {
    await finishBtn.click();
    await page.waitForTimeout(3000);
    console.log("  ✓ 已点击完成编辑");
  } else {
    console.log("  ⚠️ 未找到完成编辑按钮，停留在弹窗供查看");
  }
}

async function selectCartAndLinkForVideo(page, productLink, productTitle, approvalNumber) {
  if (!productLink) {
    console.log("  [跳过] 挂车链接为空，跳过添加标签和购物车");
    return;
  }
  console.log("设置购物车...");

  const tagSelect = page.locator('section:has-text("添加标签") .semi-select, .select-lJTtRL, .anchor-container-hgj7gj .semi-select').first();
  if (!(await tagSelect.isVisible().catch(() => false))) {
    console.log("  未找到购物车下拉框，跳过");
    return;
  }
  await dismissBlockingPortals(page);
  await clickEvenIfCovered(tagSelect, "购物车下拉框");
  await page.waitForTimeout(1500);

  const cartOpt = page.locator('[role="option"]').filter({ hasText: '购物车' }).first();
  if (await cartOpt.isVisible({ timeout: 3000 }).catch(() => false)) {
    await clickEvenIfCovered(cartOpt, "购物车选项");
    await page.waitForTimeout(2000);
    console.log("  已选择购物车");
  } else {
    await page.keyboard.press("Escape");
    console.log("  未找到购物车选项，跳过");
    return;
  }

  const linkInput = page.locator('#douyin_creator_pc_anchor_jump input, section:has-text("添加标签") input, input[placeholder*="粘贴商品"], input[placeholder*="链接"]').first();
  if (await linkInput.isVisible().catch(() => false)) {
    await linkInput.fill(productLink);
    console.log("  链接已填入");
    await page.waitForTimeout(3000);
  }

  let editModal = page.locator('.semi-modal-content').filter({ hasText: '完成编辑' }).first();
  if (await editModal.isVisible().catch(() => false)) {
    console.log("  商品编辑弹窗已自动打开");
  } else {
    const addBtn = page.locator('span:has-text("添加链接"), button:has-text("添加链接")').first();
    if (await addBtn.isVisible().catch(() => false)) {
      await clickEvenIfCovered(addBtn, "添加链接按钮");
      await page.waitForTimeout(4000);
    }
  }

  editModal = page.locator('.semi-modal-content').filter({ hasText: '完成编辑' }).first();
  if (await editModal.isVisible().catch(() => false)) {
    const limitModal = page.locator('.semi-modal-content').filter({ hasText: '无法添加购物车' }).first();
    if (await limitModal.isVisible().catch(() => false)) {
      const limitMsg = await limitModal.locator('[class*="modal-message"]').first().textContent().catch(() => "已达到限额");
      throw new Error(`购物车限额: ${limitMsg.trim()}`);
    }
    await fillProductEditModal(page, productTitle, approvalNumber);
  }
}

async function selectCartAndLinkForArticle(page, productLink, productTitle, approvalNumber) {
  if (!productLink) {
    console.log("  [跳过] 挂车链接为空，跳过添加标签和购物车");
    return;
  }
  console.log("设置购物车...");

  const anchor = page.locator('#douyin_creator_pc_anchor_jump');
  const cartSelect = anchor.locator('.semi-select').first();
  const tagSelect = page.locator('section:has-text("添加标签") .semi-select, .select-lJTtRL, .anchor-container-hgj7gj .semi-select').first();
  const select = (await cartSelect.isVisible().catch(() => false)) ? cartSelect : tagSelect;

  if (!(await select.isVisible().catch(() => false))) {
    console.log("  未找到购物车下拉框，跳过");
    return;
  }

  await dismissBlockingPortals(page);
  await clickEvenIfCovered(select, "购物车下拉框");
  await page.waitForTimeout(1500);
  const cartOpt = page.locator('[role="option"]').filter({ hasText: '购物车' }).first();
  if (await cartOpt.isVisible().catch(() => false)) {
    await clickEvenIfCovered(cartOpt, "购物车选项");
    await page.waitForTimeout(2000);
    console.log("  已选择购物车");
  } else {
    await page.keyboard.press("Escape");
    console.log("  未找到购物车选项，跳过");
    return;
  }

  const anchorInput = anchor.locator('input').first();
  const linkInput = (await anchorInput.isVisible().catch(() => false))
    ? anchorInput
    : page.locator('section:has-text("添加标签") input, input[placeholder*="粘贴商品"], input[placeholder*="链接"]').first();
  if (await linkInput.isVisible().catch(() => false)) {
    await linkInput.fill(productLink);
    console.log("  链接已填入");
  } else {
    console.log("  未找到链接输入框，跳过");
    return;
  }

  const addBtn = anchor.locator('span:has-text("添加链接"), button:has-text("添加链接")').first();
  const globalAddBtn = page.locator('span:has-text("添加链接"), button:has-text("添加链接")').first();
  const targetAddBtn = (await addBtn.isVisible().catch(() => false)) ? addBtn : globalAddBtn;
  if (!(await targetAddBtn.isVisible().catch(() => false))) {
    console.log("  未找到添加链接按钮，跳过");
    return;
  }

  await clickEvenIfCovered(targetAddBtn, "添加链接按钮");
  await page.waitForTimeout(4000);

  const limitModal = page.locator('.semi-modal-content').filter({ hasText: '无法添加购物车' }).first();
  if (await limitModal.isVisible().catch(() => false)) {
    const limitMsg = await limitModal.locator('[class*="modal-message"]').first().textContent().catch(() => "已达到限额");
    throw new Error(`购物车限额: ${limitMsg.trim()}`);
  }

  await fillProductEditModal(page, productTitle, approvalNumber);
}

module.exports = {
  selectCartAndLinkForVideo,
  selectCartAndLinkForArticle,
};
