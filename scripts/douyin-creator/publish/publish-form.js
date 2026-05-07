const { waitVisible, setTextLikeInput } = require("./dom");

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

  if (d.getTime() < minTime.getTime()) {
    console.log(`⚠️ 定时时间 ${fmtLocal(d)} 不满足最少2小时要求，改为立即发布`);
    return;
  }
  if (d.getTime() > maxTime.getTime()) {
    console.log(`⚠️ 定时时间 ${fmtLocal(d)} 超过14天上限，改为立即发布`);
    return;
  }

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

  const pad = (n) => String(n).padStart(2, "0");
  const text = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  await setTextLikeInput(input, text);
  await input.press("Enter").catch(() => {});
  console.log(`已设置定时发布时间: ${text}`);
}

module.exports = {
  selectSelfDeclaration,
  setScheduleIfNeeded,
};
