async function waitVisible(page, selectors, timeout = 15000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const started = Date.now();
  while (Date.now() - started < timeout) {
    for (const selector of list) {
      const loc = page.locator(selector).first();
      if (await loc.isVisible().catch(() => false)) {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        return loc;
      }
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

module.exports = {
  waitVisible,
  setTextLikeInput,
};
