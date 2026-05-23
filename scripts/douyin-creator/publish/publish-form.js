const { waitVisible, setTextLikeInput } = require("./dom");
const { step, info } = require("./logger");

async function getFormSectionByTitle(page, title) {
  const bySectionTitle = page
    .locator("section")
    .filter({
      has: page.locator('[class*="title"], [class*="label"]').filter({ hasText: title }),
    })
    .first();
  if (await bySectionTitle.isVisible({ timeout: 1500 }).catch(() => false)) {
    return bySectionTitle;
  }

  const maxLabelLen = Math.max(title.length + 4, 12);
  const section = page
    .locator(
      `xpath=//*[contains(normalize-space(.), "${title}") and string-length(normalize-space(.)) <= ${maxLabelLen}]/ancestor::*[.//*[contains(@class,"selectBox")] or .//*[contains(@class,"semi-select")] or .//input or .//label][1]`
    )
    .first();
  if (await section.isVisible({ timeout: 1500 }).catch(() => false)) {
    return section;
  }

  return page.locator(`section:has-text("${title}")`).first();
}

async function selectSelfDeclaration(page, isAiContent) {
  step(`设置自主声明 (isAiContent=${isAiContent})`);
  const targetLabel = isAiContent ? "内容由AI生成" : "无需添加自主声明";

  const section = await getFormSectionByTitle(page, "自主声明");
  const selectCandidates = section.locator('[class*="selectBox"], .semi-select');
  const selectBox = (await selectCandidates
    .filter({ hasText: /请选择自主声明|内容由AI生成|无需添加自主声明/ })
    .first()
    .isVisible()
    .catch(() => false))
    ? selectCandidates.filter({ hasText: /请选择自主声明|内容由AI生成|无需添加自主声明/ }).first()
    : selectCandidates.first();

  if (!(await selectBox.isVisible().catch(() => false))) {
    throw new Error("未找到自主声明下拉框");
  }

  const currentText = await selectBox.locator('[class*="selectText"], .semi-select-selection-text').first().textContent().catch(() => "");
  if (currentText.includes(targetLabel)) {
    info(`自主声明已是: ${targetLabel}`);
    return;
  }

  await selectBox.click();

  const modal = page.locator(".semi-modal-content").filter({ hasText: "请选择声明类型" }).first();
  await modal.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});

  const targetOption = modal
    .locator(`label:has-text("${targetLabel}"), [role="radio"]:has-text("${targetLabel}")`)
    .first();
  if (!(await targetOption.isVisible().catch(() => false))) {
    throw new Error(`未找到自主声明选项: ${targetLabel}`);
  }

  await targetOption.scrollIntoViewIfNeeded().catch(() => {});
  await targetOption.click().catch(async () => {
    await targetOption.locator('.semi-radio-addon, input').first().click({ force: true });
  });
  await page.waitForTimeout(300);

  const selected = await targetOption
    .evaluate((label) => {
      const input = label.querySelector("input");
      if (input?.checked) return true;
      if (String(label.className || "").includes("checked")) return true;

      const radioTarget = label.querySelector(".semi-radio-addon") || input || label;
      for (const type of ["mousedown", "mouseup", "click"]) {
        radioTarget.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
        );
      }
      return input?.checked || String(label.className || "").includes("checked");
    })
    .catch(() => false);
  if (!selected) {
    throw new Error(`自主声明选择失败：未选中 "${targetLabel}"`);
  }
  step(`已选择: ${targetLabel}`);

  const confirmBtn = modal.locator('button:has-text("确定")').first();
  if (await confirmBtn.isVisible().catch(() => false)) {
    await page.waitForFunction(
      (label) => {
        const btns = Array.from(document.querySelectorAll(".semi-modal-content button"));
        const btn = btns.find((el) => (el.innerText || "").trim() === label);
        if (!btn) return false;
        const cls = String(btn.className || "");
        return !btn.disabled && !cls.includes("disabled");
      },
      "确定",
      { timeout: 5000 }
    );
    await confirmBtn.click();
    await modal.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
    step("已确定关闭自主声明弹窗");
  }

  const updatedText = await section
    .locator('[class*="selectText"], .semi-select-selection-text')
    .first()
    .textContent({ timeout: 3000 })
    .catch(() => "");
  if (!updatedText.includes(targetLabel)) {
    throw new Error(
      `自主声明设置未生效：期望 "${targetLabel}"，实际 "${updatedText.trim() || "(空)"}"`
    );
  }
}

function fmtLocal(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function setScheduleIfNeeded(page, scheduleAt) {
  if (!scheduleAt) return;

  const now = new Date();
  const MIN_OFFSET_MS = 2 * 60 * 60 * 1000;
  const MAX_OFFSET_MS = 14 * 24 * 60 * 60 * 1000;

  const d = new Date(scheduleAt);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`无效的定时发布时间: ${scheduleAt}`);
  }

  const minTime = new Date(now.getTime() + MIN_OFFSET_MS);
  const maxTime = new Date(now.getTime() + MAX_OFFSET_MS);

  if (d.getTime() <= now.getTime()) {
    throw new Error(
      `定时时间不满足平台要求: ${fmtLocal(d)} 已早于当前时间，无法设置定时发布`
    );
  }
  if (d.getTime() < minTime.getTime()) {
    throw new Error(
      `定时时间不满足平台要求: ${fmtLocal(d)} 距当前不足2小时，无法设置定时发布`
    );
  }
  if (d.getTime() > maxTime.getTime()) {
    throw new Error(
      `定时时间不满足平台要求: ${fmtLocal(d)} 超过14天上限，无法设置定时发布`
    );
  }

  const scheduleToggle = await waitVisible(page, [
    'label:has-text("定时发布")',
    'text=定时发布',
  ]);
  await scheduleToggle.click();

  const input = await waitVisible(page, [
    'input[placeholder="日期和时间"]',
    'input[placeholder*="日期"]',
    'input[placeholder*="时间"]',
    '.semi-datepicker input',
  ]);
  await input.click();

  const pad = (n) => String(n).padStart(2, "0");
  const text = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  await setTextLikeInput(input, text);
  await input.press("Enter").catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && typeof active.blur === "function") active.blur();
  }).catch(() => {});
  await page.waitForTimeout(500);
  step(`已设置定时发布: ${text}`);
}

module.exports = {
  selectSelfDeclaration,
  setScheduleIfNeeded,
};
