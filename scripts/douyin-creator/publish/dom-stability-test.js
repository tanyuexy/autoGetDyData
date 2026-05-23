#!/usr/bin/env node
const path = require("path");
const fse = require("fs-extra");
const { chromium } = require("../../common/stealth-browser");
const { PUBLISH_BROWSER_VIEWPORT, HEADLESS } = require("../core/env");
const { fillTitleAndDescription, normalizeDescriptionForPublish } = require("./editor");
const { selectSelfDeclaration, setScheduleIfNeeded } = require("./publish-form");
const { selectCartAndLinkForArticle, selectCartAndLinkForVideo } = require("./product-link");
const {
  checkImagesUploaded,
  checkVideoUploaded,
  checkTitleFilled,
  checkBodyFilled,
  checkHashtagsSet,
  checkScheduleSet,
  checkProductLinkSet,
  checkProductLinkAbsent,
  checkSelfDeclarationSet,
  checkMusicSelected,
  checkCoverSelected,
  scrollPublishFormToBottom,
  optimizePublishPageForViewing,
  waitForPageSettled,
  scaledMs,
} = require("./runtime");

const ACCOUNT = "维乐多官方旗舰店";
const STORAGE = path.join(process.cwd(), "storage/creator-accounts/维乐多官方旗舰店/storageState.json");
const MATERIALS = path.join(process.cwd(), "storage/creator-materials");
const ARTICLE_URL =
  "https://creator.douyin.com/creator-micro/content/post/image?default-tab=3&enter_from=publish_page&media_type=image&type=new";
const VIDEO_URL = "https://creator.douyin.com/creator-micro/content/post/video";
const PRODUCT_LINK = "https://v.douyin.com/aVEvlyCGACM/";
const PRODUCT_TITLE = "五维赖氨酸颗粒";
const APPROVAL = "不包含广审内容";
const ARTICLE_DESC =
  "宝宝挑食不吃饭？试试这个五维赖氨酸颗粒，酸甜口感好吸收！日常补充营养，助力成长每一步～\n\n#五维赖氨酸 #健康好物计划 #维生素b #宝宝挑食 #吃饭香香长高高";
const VIDEO_DESC =
  "平时吃饭少吸收差，多亏维乐多五维赖氨酸，补齐多种维生素营养好吸收！\n\n#孩子长高 #孩子没有胃口吃什么 #赖氨酸 #儿童补钙 #健康好物计划";

function scheduleAt() {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
  return d.toISOString();
}

async function dismissDialogs(page) {
  for (let i = 0; i < 3; i++) {
    const btn = page.locator('button:has-text("我知道了")').first();
    if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(500);
    } else break;
  }
}

async function uploadImages(page, imageKey) {
  const filePath = path.join(MATERIALS, imageKey);
  if (!(await fse.pathExists(filePath))) throw new Error(`图片不存在: ${filePath}`);
  await waitForPageSettled(page, { afterClick: false, minWaitMs: 2000 });
  const uploadBtn = page.locator('div:has-text("点击上传")').last();
  if (!(await uploadBtn.isVisible({ timeout: scaledMs(8000) }).catch(() => false))) {
    throw new Error("上传按钮不可见");
  }
  const chooser = page.waitForEvent("filechooser", { timeout: scaledMs(30000) });
  await uploadBtn.click();
  const fc = await chooser.catch(() => null);
  if (!fc) throw new Error("无法触发 filechooser");
  await fc.setFiles([filePath]);
  await page.waitForTimeout(scaledMs(8000));
}

async function uploadVideo(page, videoKey) {
  const filePath = path.join(MATERIALS, videoKey);
  if (!(await fse.pathExists(filePath))) throw new Error(`视频不存在: ${filePath}`);
  await page.waitForSelector('input[type="file"][accept*="video"]', { state: "attached", timeout: scaledMs(30000) }).catch(() => {});
  const input = page.locator('input[type="file"][accept*="video"]').first();
  if ((await input.count()) === 0) throw new Error("视频 file input 不存在");
  await input.setInputFiles(filePath);
  await checkVideoUploaded(page, { timeoutMs: 120000 });
}

async function selectMusic(page) {
  const musicAction = page.locator('span:has-text("选择音乐")').last();
  if (!(await musicAction.isVisible().catch(() => false))) throw new Error("未找到选择音乐");
  await musicAction.scrollIntoViewIfNeeded().catch(() => {});
  await musicAction.click({ timeout: scaledMs(5000) });
  await page.waitForTimeout(scaledMs(2500));
  const hotTab = page.locator('div[role="tab"]:has-text("热门榜")').first();
  if (!(await hotTab.isVisible({ timeout: scaledMs(5000) }).catch(() => false))) throw new Error("未找到热门榜");
  await hotTab.click();
  await page.waitForTimeout(scaledMs(2500));
  const songNames = page.locator('.semi-tabs-pane-active [class*="song-name"], [class*="song-name"]');
  const count = await songNames.count();
  if (count === 0) throw new Error("热门榜无歌曲");
  for (let i = 0; i < Math.min(count, 6); i++) {
    const song = songNames.nth(i);
    const card = song.locator('xpath=./ancestor::*[contains(@class, "card-wrapper")][1]');
    const target = (await card.count()) > 0 ? card.first() : song;
    await target.hover().catch(() => {});
    await page.waitForTimeout(600);
    const clicked = await song.evaluate((node) => {
      const cardEl = node.closest('[class*="card-wrapper"]');
      const use = Array.from(cardEl?.querySelectorAll("button, [role='button']") || []).find((b) => (b.textContent || "").trim() === "使用");
      if (!use) return false;
      use.click();
      return true;
    }).catch(() => false);
    if (clicked) {
      await page.waitForTimeout(2000);
      return;
    }
  }
  throw new Error("未能点击使用按钮选音乐");
}

async function selectFirstFrameAsCover(page) {
  const container = await page.waitForSelector('[class*="recommendCoverContainer"]', { timeout: scaledMs(60000) }).catch(() => null);
  if (!container) throw new Error("封面容器未出现");
  const items = page.locator('[class*="recommendCoverContainer"] > [class*="recommendCover"]');
  for (let attempt = 0; attempt < 30; attempt++) {
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      if (!(await item.isVisible().catch(() => false))) continue;
      if ((await item.locator("img").count()) === 0) continue;
      await item.click().catch(() => {});
      await page.waitForTimeout(1000);
      const dialog = page.locator('[role="modal"], [role="dialog"]').filter({ hasText: "是否确认应用此封面？" });
      const ok = dialog.getByRole("button", { name: "确定" });
      if (await ok.isVisible({ timeout: 3000 }).catch(() => false)) await ok.click();
      return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error("无法选择封面");
}

async function runStep(report, name, fn, verify) {
  const started = Date.now();
  try {
    await fn();
    if (verify) await verify();
    report.steps.push({ name, ok: true, ms: Date.now() - started });
  } catch (error) {
    report.steps.push({ name, ok: false, ms: Date.now() - started, error: error.message });
    report.failed = true;
  }
}

async function testScenario(browser, scenario) {
  const report = { scenario: scenario.name, steps: [], failed: false };
  const context = await browser.newContext({ storageState: STORAGE, viewport: PUBLISH_BROWSER_VIEWPORT });
  const page = await context.newPage();
  const { body: expectedBody, hashtags } = normalizeDescriptionForPublish(scenario.desc);
  const limitedHashtags = hashtags.slice(0, 5);
  const sched = scheduleAt();

  try {
    await runStep(report, "打开发布页", async () => {
      await page.goto(scenario.url, { waitUntil: "domcontentloaded" });
      await waitForPageSettled(page, { afterClick: false, minWaitMs: 3000 });
      await dismissDialogs(page);
      await optimizePublishPageForViewing(page);
    });

    await runStep(
      report,
      scenario.type === "article" ? "上传图文" : "上传视频",
      async () => {
        if (scenario.type === "article") await uploadImages(page, scenario.media);
        else await uploadVideo(page, scenario.media);
      },
      async () => {
        if (scenario.type === "article") await checkImagesUploaded(page, 1);
      }
    );

    await runStep(
      report,
      "定时发布",
      async () => setScheduleIfNeeded(page, sched),
      async () => checkScheduleSet(page)
    );

    if (scenario.withCart) {
      await runStep(
        report,
        "挂车链接",
        async () => {
          if (scenario.type === "article") {
            await selectCartAndLinkForArticle(page, PRODUCT_LINK, PRODUCT_TITLE, APPROVAL);
          } else {
            await selectCartAndLinkForVideo(page, PRODUCT_LINK, PRODUCT_TITLE, APPROVAL);
          }
        },
        async () => checkProductLinkSet(page, PRODUCT_TITLE)
      );
    } else {
      await runStep(report, "不挂车校验", async () => checkProductLinkAbsent(page));
    }

    await runStep(
      report,
      "正文与话题",
      async () => fillTitleAndDescription(page, "", scenario.desc),
      async () => {
        await checkTitleFilled(page, "");
        await checkBodyFilled(page, expectedBody);
        await checkHashtagsSet(page, limitedHashtags);
      }
    );

    if (scenario.type === "video") {
      await runStep(
        report,
        "视频封面",
        async () => selectFirstFrameAsCover(page),
        async () => checkCoverSelected(page)
      );
    }

    await runStep(
      report,
      "自主声明",
      async () => selectSelfDeclaration(page, scenario.isAi),
      async () => checkSelfDeclarationSet(page, scenario.isAi)
    );

    if (scenario.type === "article") {
      await runStep(
        report,
        "选择配乐",
        async () => selectMusic(page),
        async () => checkMusicSelected(page)
      );
    }

    await runStep(report, "滚动至发布区", async () => scrollPublishFormToBottom(page));

    await runStep(report, "发布按钮可见", async () => {
      const btn = page.locator('button:has-text("发布")').filter({ hasNotText: "定时" }).first();
      if (!(await btn.isVisible({ timeout: 5000 }).catch(() => false))) throw new Error("发布按钮不可见");
    });
  } finally {
    await context.close();
  }

  report.passed = report.steps.filter((s) => s.ok).length;
  report.total = report.steps.length;
  report.success = !report.failed;
  return report;
}

(async () => {
  const scenarios = [
    { name: "图文+挂车", type: "article", withCart: true, url: ARTICLE_URL, media: "image-14.png", desc: ARTICLE_DESC, isAi: true },
    { name: "图文+不挂车", type: "article", withCart: false, url: ARTICLE_URL, media: "image-14.png", desc: ARTICLE_DESC, isAi: true },
    { name: "视频+挂车", type: "video", withCart: true, url: VIDEO_URL, media: "5月15日(10).mp4", desc: VIDEO_DESC, isAi: false },
    { name: "视频+不挂车", type: "video", withCart: false, url: VIDEO_URL, media: "5月15日(10).mp4", desc: VIDEO_DESC, isAi: false },
  ];

  const browser = await chromium.launch({ headless: HEADLESS !== "false" });
  const reports = [];
  for (const scenario of scenarios) {
    console.log(`\n===== ${scenario.name} =====`);
    const report = await testScenario(browser, scenario);
    reports.push(report);
    console.log(JSON.stringify(report, null, 2));
  }
  await browser.close();

  const summary = {
    account: ACCOUNT,
    testedAt: new Date().toISOString(),
    scenarios: reports.map((r) => ({
      name: r.scenario,
      success: r.success,
      passed: r.passed,
      total: r.total,
      failedSteps: r.steps.filter((s) => !s.ok).map((s) => ({ name: s.name, error: s.error })),
    })),
  };
  console.log("\n===== SUMMARY =====");
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.scenarios.some((s) => !s.success) ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
