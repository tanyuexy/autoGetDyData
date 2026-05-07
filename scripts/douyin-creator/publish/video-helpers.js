const { VIDEO_POST_URL } = require("./utils");

function logVideoPublishStart(accountName, options) {
  console.log(`开始视频发布准备: ${accountName}`);
  console.log(
    `  [选项] productLink=${JSON.stringify(String(options.productLink || ""))} isAiContent=${JSON.stringify(options.isAiContent)} title=${JSON.stringify(options.title)}`
  );
}

async function gotoVideoPublishPage(page) {
  await page.goto(VIDEO_POST_URL, { waitUntil: "domcontentloaded" });
  await page
    .waitForSelector('input[placeholder*="标题"]', { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  await page
    .evaluate(() => {
      window.scrollTo(0, 0);
      document.body?.scrollIntoView?.();
    })
    .catch(() => {});
}

function resolveVideoPublishControls(options) {
  return {
    publishEnabled:
      options.publishEnabled !== "false" && options.publishEnabled !== false,
    publishWaitSec: Number(options.publishWaitSec) || 3,
  };
}

module.exports = {
  logVideoPublishStart,
  gotoVideoPublishPage,
  resolveVideoPublishControls,
};
