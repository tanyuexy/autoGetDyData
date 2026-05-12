/**
 * 稿文审核状态抓取脚本
 * 登录抖音创作者平台，抓取「作品管理」中每条内容的审核状态
 *
 * 用法:
 *   node scripts/douyin-creator/review.js 账号A 账号B
 *   或通过环境变量 REVIEW_ACCOUNTS=账号A,账号B 指定
 */

const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright");
const { ensureDir } = require("../common/fs");
const { getAccountPaths } = require("./lib/accounts");
const { BROWSER_VIEWPORT, HEADLESS } = require("./lib/env");
const { openTargetAndEnsureLogin, clickIfVisible } = require("./lib/login");
const { saveAuth } = require("./lib/exporter");

const CONTENT_MANAGE_URL = "https://creator.douyin.com/creator-micro/content/manage";
const REVIEW_SCREENSHOT_DIR_NAME = "review-screenshots";
const WORK_LIST_PATH = "/janus/douyin/creator/pc/work_list";
const WORK_LIST_PAGE_SIZE = 12;
const REVIEW_SCOPE_OPTIONS = {
  all: { label: "全部", apiStatus: 0, statuses: ["under_review", "approved", "rejected"] },
  approved: { label: "已通过", apiStatus: 1, statuses: ["approved"] },
  under_review: { label: "审核中", apiStatus: 2, statuses: ["under_review"] },
  rejected: { label: "未通过", apiStatus: 3, statuses: ["rejected"] },
};

/**
 * 生成稳定短 id。作品管理页卡片没有稳定暴露 item id 时，用标题+发布时间兜底。
 */
function shortHash(input) {
  return crypto.createHash("sha1").update(String(input || "")).digest("hex").slice(0, 16);
}

function safeFilePart(input, fallback = "item") {
  const cleaned = String(input || "")
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
  return cleaned || fallback;
}

function normalizeTitleKey(input) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function itemKey(item) {
  return `${item.publishDate || ""}::${normalizeTitleKey(item.title)}`;
}

function mapKeyForItem(item) {
  return item.postId || itemKey(item);
}

function formatUnixSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "";
  const d = new Date(n * 1000);
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function firstUrl(media) {
  if (!media) return "";
  if (Array.isArray(media.url_list) && media.url_list[0]) return media.url_list[0];
  return media.url || "";
}

function inferReviewStatusFromAweme(aweme) {
  const status = aweme?.status || {};
  if (aweme?.status_value === 144 && !status.is_private && status.private_status !== 1) return "rejected";
  if (status.in_reviewing) return "under_review";
  return "approved";
}

function normalizeWorkListAweme(aweme) {
  const postId = String(aweme?.aweme_id || aweme?.item_id || "").trim();
  const title = normalizeTitleKey(aweme?.desc || aweme?.item_title || "");
  const coverUrl =
    firstUrl(aweme?.Cover) ||
    firstUrl(aweme?.cover) ||
    firstUrl(aweme?.video?.cover) ||
    firstUrl(Array.isArray(aweme?.images) ? aweme.images[0] : null);

  if (!postId && !title) return null;
  return {
    postId: postId || `content-${shortHash(`${title}:${aweme?.create_time || ""}`)}`,
    title,
    publishDate: formatUnixSeconds(aweme?.create_time) || new Date().toISOString(),
    reviewStatus: inferReviewStatusFromAweme(aweme),
    coverUrl: coverUrl || undefined,
  };
}

async function fetchWorkListPage(context, { status = 0, maxCursor = 0, count = WORK_LIST_PAGE_SIZE } = {}) {
  const params = new URLSearchParams({
    scene: "star_atlas",
    device_platform: "android",
    status: String(status),
    count: String(count),
    max_cursor: String(maxCursor || 0),
    cookie_enabled: "true",
    screen_width: String(BROWSER_VIEWPORT.width),
    screen_height: String(BROWSER_VIEWPORT.height),
    browser_language: "zh-CN",
    browser_platform: "MacIntel",
    browser_name: "Mozilla",
    browser_version:
      "5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    browser_online: "true",
    timezone_name: "Asia/Shanghai",
    aid: "1128",
    support_h265: "1",
  });

  const response = await context.request.get(`https://creator.douyin.com${WORK_LIST_PATH}?${params}`, {
    headers: {
      referer: CONTENT_MANAGE_URL,
    },
    timeout: 60000,
  });
  if (!response.ok()) {
    throw new Error(`work_list 请求失败: HTTP ${response.status()}`);
  }
  const json = await response.json();
  if (json?.status_code !== 0) {
    throw new Error(`work_list 返回异常: ${json?.status_msg || json?.status_code}`);
  }
  return json;
}

async function fetchAllReviewItemsFromApi(context, reviewScope = "all") {
  const scope = REVIEW_SCOPE_OPTIONS[reviewScope] || REVIEW_SCOPE_OPTIONS.all;
  const byKey = new Map();
  let maxCursor = 0;
  const seenCursors = new Set();

  for (let pageNo = 1; pageNo <= 30; pageNo++) {
    const data = await fetchWorkListPage(context, { status: scope.apiStatus, maxCursor });
    const list = Array.isArray(data.aweme_list) ? data.aweme_list : [];
    for (const aweme of list) {
      const item = normalizeWorkListAweme(aweme);
      if (!item) continue;
      if (reviewScope !== "all" && !scope.statuses.includes(item.reviewStatus)) continue;
      mergeItem(byKey, item);
    }

    console.log(`[review] work_list 第 ${pageNo} 页: ${list.length} 条`);
    if (!data.has_more || list.length === 0) break;

    const nextCursor = Number(data.max_cursor || 0);
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    maxCursor = nextCursor;
  }

  return byKey;
}

async function dismissFloatingTips(page) {
  for (const text of ["我知道了", "知道了"]) {
    await clickIfVisible(page.getByText(text, { exact: true }), 800).catch(() => false);
  }
}

async function openContentManagePage(page) {
  await page.goto(CONTENT_MANAGE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  await page.getByText("作品管理", { exact: true }).first().waitFor({ timeout: 15000 });
  await page.getByText("全部作品", { exact: true }).first().waitFor({ timeout: 15000 });
  await dismissFloatingTips(page);
}

async function clickManageTab(page, label) {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(300);
  const tab = page.getByText(label, { exact: true }).first();
  await tab.waitFor({ state: "visible", timeout: 10000 });
  await tab.click({ timeout: 5000 });
  await page.waitForFunction(
    () => {
      const text = document.body?.innerText || "";
      if (/加载中|请稍后|loading/i.test(text)) return false;
      return /没有更多作品/.test(text) || /删除作品/.test(text);
    },
    { timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(800);
  await dismissFloatingTips(page);
}

function reviewScopeFromArg(value) {
  const scope = String(value || "").trim();
  return REVIEW_SCOPE_OPTIONS[scope] ? scope : "all";
}

function mergeItem(map, item, tabStatus) {
  if (!item || !item.title) return;
  const key = mapKeyForItem(item);
  const prev = map.get(key) || {};
  const reviewStatus = tabStatus || item.reviewStatus || prev.reviewStatus || "approved";
  map.set(key, {
    ...prev,
    ...item,
    postId: item.postId || prev.postId || `content-${shortHash(key)}`,
    reviewStatus,
  });
}

async function extractVisibleManageCards(page, tabStatus = null) {
  return page.evaluate((forcedStatus) => {
    function normalizeDate(raw) {
      const m = String(raw || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (!m) return "";
      const [, y, mo, d, h, mi, s = "00"] = m;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")} ${h.padStart(2, "0")}:${mi}:${s.padStart(2, "0")}`;
    }

    function inferStatus(text) {
      if (forcedStatus) return forcedStatus;
      if (/审核中|待审核|审核中/.test(text)) return "under_review";
      if (/限制自己可见|审核未通过|未通过|不通过/.test(text)) return "rejected";
      return "approved";
    }

    function parseTitle(lines) {
      const actionIndex = lines.findIndex((line) => /编辑作品|设置权限|作品置顶|取消置顶|删除作品/.test(line));
      const head = actionIndex >= 0 ? lines.slice(0, actionIndex) : lines.slice(0, 4);
      const titleLines = head.filter((line) => {
        if (/^置顶$|^私密$/.test(line)) return false;
        if (/^\d+张$/.test(line)) return false;
        if (/^\d{2}:\d{2}$/.test(line)) return false;
        return line.trim().length > 0;
      });
      return titleLines.join(" ").replace(/\s+/g, " ").trim();
    }

    function topCards() {
      return Array.from(document.querySelectorAll("div[class*='video-card-']")).filter((el) => {
        const cls = String(el.className || "");
        const text = el.innerText || "";
        return (
          (text.includes("编辑作品") || text.includes("删除作品")) &&
          !cls.includes("video-card-content") &&
          !cls.includes("video-card-info")
        );
      });
    }

    return topCards().map((card, index) => {
      const text = (card.innerText || "").trim();
      const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      const publishLine = lines.find((line) => /\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}/.test(line)) || "";
      const publishDate = normalizeDate(publishLine);
      const title = parseTitle(lines);
      const img = card.querySelector("img");
      return {
        index,
        title,
        publishDate,
        reviewStatus: inferStatus(text),
        coverUrl: img ? img.currentSrc || img.src || "" : "",
        hasDetail: text.includes("查看详情"),
      };
    }).filter((item) => item.title || item.publishDate);
  }, tabStatus);
}

async function collectCardsFromCurrentTab(page, tabStatus) {
  const byKey = new Map();

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(600);

  for (let round = 0; round < 30; round++) {
    const items = await extractVisibleManageCards(page, tabStatus);
    for (const item of items) mergeItem(byKey, item, tabStatus);

    const state = await page.evaluate(() => ({
      y: window.scrollY,
      height: document.documentElement.scrollHeight || document.body.scrollHeight,
      viewport: window.innerHeight,
      noMore: document.body.innerText.includes("没有更多作品"),
    }));

    if (state.noMore && state.y + state.viewport >= state.height - 80) break;

    await page.evaluate(() => {
      const delta = Math.max(700, Math.floor(window.innerHeight * 0.85));
      window.scrollBy(0, delta);
      const scrollers = Array.from(document.querySelectorAll("body *")).filter((el) => {
        const style = window.getComputedStyle(el);
        return /(auto|scroll)/.test(`${style.overflowY}${style.overflow}`) && el.scrollHeight > el.clientHeight + 20;
      });
      for (const el of scrollers) el.scrollBy(0, delta);
    }).catch(() => {});
    await page.waitForTimeout(1200);
  }

  return Array.from(byKey.values());
}

async function closeReviewDialog(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(600);
  if (!(await page.locator("iframe[src*='community_security']").first().isVisible({ timeout: 600 }).catch(() => false))) {
    return;
  }

  const box = await page.locator("iframe[src*='community_security']").first().boundingBox().catch(() => null);
  if (box) {
    await page.mouse.click(box.x + box.width - 28, box.y + 34).catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function findReviewDialogClip(page, iframe) {
  const iframeBox = await iframe.boundingBox().catch(() => null);
  if (!iframeBox) return null;

  const frame = await getFrameFromIframe(iframe);
  if (!frame) return null;

  const rect = await frame.evaluate(() => {
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const candidates = Array.from(document.querySelectorAll("body *"))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          area: r.width * r.height,
          bg: style.backgroundColor,
          radius: style.borderRadius,
        };
      })
      .filter((r) => {
        const whiteBg = /rgba?\(255,\s*255,\s*255/i.test(r.bg);
        const modalSized = r.width >= 520 && r.height >= 360 && r.width <= vw * 0.85 && r.height <= vh * 0.85;
        return whiteBg && modalSized;
      })
      .sort((a, b) => b.area - a.area);
    return candidates[0] || null;
  }).catch(() => null);

  if (!rect) return null;
  return {
    x: Math.max(0, iframeBox.x + rect.x - 8),
    y: Math.max(0, iframeBox.y + rect.y - 8),
    width: Math.min(BROWSER_VIEWPORT.width, rect.width + 16),
    height: Math.min(BROWSER_VIEWPORT.height, rect.height + 16),
  };
}

async function getFrameFromIframe(iframe) {
  const iframeHandle = await iframe.elementHandle().catch(() => null);
  return iframeHandle ? await iframeHandle.contentFrame().catch(() => null) : null;
}

async function waitForReviewDialogLoaded(page, iframe, timeoutMs = 30000) {
  const frame = await getFrameFromIframe(iframe);
  if (!frame) {
    await page.waitForTimeout(2500).catch(() => {});
    return false;
  }

  const start = Date.now();
  let lastText = "";
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    const state = await frame.evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const loading = /加载中|请稍后|loading/i.test(text);
      const ready = /作品审核通知|审核结果|违规原因|本作品/.test(text) && !loading;
      const imgPending = Array.from(document.images || []).some((img) => !img.complete);
      return { text, ready, imgPending };
    }).catch(() => ({ text: "", ready: false, imgPending: true }));

    if (state.ready && !state.imgPending) {
      if (state.text === lastText) stableCount += 1;
      else stableCount = 0;
      lastText = state.text;
      if (stableCount >= 2) return true;
    } else {
      stableCount = 0;
      lastText = state.text;
    }

    await page.waitForTimeout(600);
  }

  return false;
}

async function waitForCardLoaded(page, card, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await card.evaluate((el) => {
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      const loading = /加载中|请稍后|loading/i.test(text);
      const imagesReady = Array.from(el.querySelectorAll("img")).every((img) => img.complete);
      const rect = el.getBoundingClientRect();
      return !loading && imagesReady && rect.width > 0 && rect.height > 0;
    }).catch(() => false);
    if (ready) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function captureCardScreenshot(page, card, screenshotPath) {
  await card.scrollIntoViewIfNeeded().catch(() => {});
  await waitForCardLoaded(page, card);
  await page.waitForTimeout(400);

  try {
    await card.screenshot({ path: screenshotPath });
    return;
  } catch {}

  const box = await card.boundingBox().catch(() => null);
  if (box) {
    await page.screenshot({
      path: screenshotPath,
      clip: {
        x: Math.max(0, box.x - 4),
        y: Math.max(0, box.y - 4),
        width: Math.min(BROWSER_VIEWPORT.width, box.width + 8),
        height: Math.min(BROWSER_VIEWPORT.height, box.height + 8),
      },
    });
    return;
  }

  await page.screenshot({ path: screenshotPath, fullPage: false });
}

async function captureRejectedDetailScreenshots(page, paths, accountName, itemsByKey) {
  const screenshotDir = path.join(paths.dataDir, REVIEW_SCREENSHOT_DIR_NAME);
  await ensureDir(screenshotDir);
  const rejectedTitles = new Set(
    Array.from(itemsByKey.values())
      .filter((item) => item.reviewStatus === "rejected")
      .map((item) => normalizeTitleKey(item.title))
      .filter(Boolean)
  );
  console.log(`[review] 账号 ${accountName} 未通过截图候选 ${rejectedTitles.size} 条`);

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(600);

  const processed = new Set();

  for (let round = 0; round < 30; round++) {
    const visibleItems = await extractVisibleManageCards(page, "rejected");
    if (round === 0) {
      console.log(`[review] 账号 ${accountName} 未通过页首屏可见 ${visibleItems.length} 条`);
    }
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("div[class*='video-card-']")).filter((el) => {
        const cls = String(el.className || "");
        const text = el.innerText || "";
        return (
          (text.includes("编辑作品") || text.includes("删除作品")) &&
          !cls.includes("video-card-content") &&
          !cls.includes("video-card-info")
        );
      });
      cards.forEach((card, index) => card.setAttribute("data-review-card-index", String(index)));
    }).catch(() => {});

    for (const item of visibleItems) {
      const key = itemKey(item);
      const titleKey = normalizeTitleKey(item.title);
      if (!rejectedTitles.has(titleKey)) continue;

      const card = page.locator(`[data-review-card-index="${item.index}"]`).first();
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(300);

      const current =
        itemsByKey.get(key) ||
        Array.from(itemsByKey.values()).find(
          (candidate) =>
            candidate.reviewStatus === "rejected" && normalizeTitleKey(candidate.title) === titleKey
        );
      if (!current || current.reviewStatus !== "rejected") {
        console.warn(`[review] 账号 ${accountName} 跳过非未通过卡片截图: ${item.title}`);
        continue;
      }
      const processKey = mapKeyForItem(current);
      if (processed.has(processKey)) continue;
      processed.add(processKey);

      const screenshotPath = path.join(
        screenshotDir,
        `review-rejected-${Date.now()}-${safeFilePart(item.title)}.png`
      );
      let objectId = "";
      let screenshotType = "卡片";

      if (item.hasDetail) {
        await card.getByText("查看详情", { exact: true }).first().click({ timeout: 5000 });

        const iframe = page.locator("iframe[src*='community_security']").first();
        await iframe.waitFor({ state: "visible", timeout: 15000 });
        const dialogLoaded = await waitForReviewDialogLoaded(page, iframe);
        if (!dialogLoaded) {
          console.warn(`[review] 账号 ${accountName} 审核详情弹窗等待加载超时，仍尝试截图: ${item.title}`);
        }
        await page.waitForTimeout(500);

        const src = (await iframe.getAttribute("src").catch(() => "")) || "";
        objectId = (src.match(/[?&]object_id=(\d+)/) || [])[1] || "";

        const clip = await findReviewDialogClip(page, iframe);
        if (clip) {
          await page.screenshot({ path: screenshotPath, clip });
        } else {
          await page.screenshot({ path: screenshotPath, fullPage: false });
        }
        screenshotType = "详情弹窗";
      } else {
        await captureCardScreenshot(page, card, screenshotPath);
      }

      const next = {
        ...current,
        ...item,
        postId: current.postId || objectId || `content-${shortHash(key)}`,
        reviewStatus: "rejected",
        rejectionReason: screenshotPath,
        rejectionScreenshotPath: screenshotPath,
      };
      itemsByKey.delete(key);
      itemsByKey.delete(mapKeyForItem(current));
      itemsByKey.set(next.postId, next);

      console.log(`[review] 账号 ${accountName} 已保存未通过${screenshotType}截图: ${screenshotPath}`);
      if (item.hasDetail) await closeReviewDialog(page);
    }

    const state = await page.evaluate(() => ({
      y: window.scrollY,
      height: document.documentElement.scrollHeight || document.body.scrollHeight,
      viewport: window.innerHeight,
      noMore: document.body.innerText.includes("没有更多作品"),
    })).catch(() => ({ y: 0, height: 0, viewport: 0, noMore: false }));

    if (state.noMore && state.y + state.viewport >= state.height - 80) break;
    await page.evaluate(() => {
      const delta = Math.max(700, Math.floor(window.innerHeight * 0.85));
      window.scrollBy(0, delta);
      const scrollers = Array.from(document.querySelectorAll("body *")).filter((el) => {
        const style = window.getComputedStyle(el);
        return /(auto|scroll)/.test(`${style.overflowY}${style.overflow}`) && el.scrollHeight > el.clientHeight + 20;
      });
      for (const el of scrollers) el.scrollBy(0, delta);
    }).catch(() => {});
    await page.waitForTimeout(1200);
  }
}

/**
 * 为单个账号抓取审核状态
 */
async function scrapeReviewForAccount(browser, accountName, reviewScope = "all") {
  const scope = REVIEW_SCOPE_OPTIONS[reviewScope] || REVIEW_SCOPE_OPTIONS.all;
  const paths = getAccountPaths(accountName);
  await ensureDir(paths.accountDir);
  await ensureDir(paths.dataDir);

  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    storageState: paths.storageStatePath,
  });
  let page = null;

  try {
    page = await context.newPage();
    console.log(`\n[review] 开始处理账号: ${accountName}`);

    await openTargetAndEnsureLogin(page, paths, accountName, {
      hasStoredAuth: true,
      forceManualLogin: false,
      sendLoginAlerts: false,
      onLoggedIn: async () => {
        await saveAuth(context, paths, accountName);
      },
    });

    await openContentManagePage(page);

    console.log(`[review] 账号 ${accountName} 通过 work_list 接口读取${scope.label}作品列表`);
    const itemsByKey = await fetchAllReviewItemsFromApi(context, reviewScope);
    console.log(`[review] 账号 ${accountName} 接口抓取 ${itemsByKey.size} 条`);
    const statusCounts = Array.from(itemsByKey.values()).reduce((acc, item) => {
      const status = item.reviewStatus || "approved";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    console.log(`[review] 账号 ${accountName} 状态统计: ${JSON.stringify(statusCounts)}`);

    if (Array.from(itemsByKey.values()).some((item) => item.reviewStatus === "rejected")) {
      await clickManageTab(page, "未通过");
      await captureRejectedDetailScreenshots(page, paths, accountName, itemsByKey);
    }

    const items = Array.from(itemsByKey.values()).map((item) => {
      const key = itemKey(item);
      return {
        postId: item.postId || `content-${shortHash(key)}`,
        title: item.title || "",
        publishDate: item.publishDate || new Date().toISOString(),
        reviewStatus: item.reviewStatus || "approved",
        rejectionReason: item.rejectionReason,
        rejectionScreenshotPath: item.rejectionScreenshotPath,
        coverUrl: item.coverUrl || undefined,
      };
    });
    console.log(`[review] 账号 ${accountName} 抓取到 ${items.length} 条内容`);

    return { accountName, ok: true, reviewScope, reviewStatuses: scope.statuses, items };
  } catch (error) {
    console.error(`[review] 账号 ${accountName} 抓取失败:`, error.message || error);
    return { accountName, ok: false, error: error.message || String(error), items: [] };
  } finally {
    await context.close();
  }
}

/**
 * 批量抓取多个账号的审核状态，输出 JSON 到 stdout
 */
async function main() {
  const args = process.argv.slice(2);
  let reviewScope = reviewScopeFromArg(process.env.REVIEW_SCOPE || "all");
  let accountNames = [];
  for (const arg of args) {
    if (arg.startsWith("--review-scope=")) {
      reviewScope = reviewScopeFromArg(arg.slice("--review-scope=".length));
      continue;
    }
    if (arg.startsWith("--status=")) {
      reviewScope = reviewScopeFromArg(arg.slice("--status=".length));
      continue;
    }
    if (arg) accountNames.push(arg);
  }

  // 支持通过环境变量指定账号
  if (accountNames.length === 0 && process.env.REVIEW_ACCOUNTS) {
    accountNames = process.env.REVIEW_ACCOUNTS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (accountNames.length === 0) {
    // 获取所有可用账号
    const { listAccountDirs } = require("./lib/accounts");
    accountNames = await listAccountDirs();
  }

  if (accountNames.length === 0) {
    console.error("[review] 未找到可用账号");
    process.exit(1);
  }

  console.log(
    `[review] 将处理 ${accountNames.length} 个账号: ${accountNames.join(", ")}，抓取范围: ${REVIEW_SCOPE_OPTIONS[reviewScope].label}`
  );

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized"],
  });

  const allResults = [];

  try {
    for (const accountName of accountNames) {
      const result = await scrapeReviewForAccount(browser, accountName, reviewScope);
      allResults.push(result);
    }
  } finally {
    await browser.close();
  }

  // 回调内部 API 保存结果到 MongoDB
  const successResults = allResults.filter((r) => r.ok);
  if (successResults.length > 0) {
    try {
      const { postInternalApi } = require("../common/internal-api-client");
      const saveResult = await postInternalApi("/api/review/save", { results: successResults });
      console.log(`[review] 已通过内部 API 保存 ${saveResult.saved || 0} 条审核记录到 MongoDB`);
    } catch (e) {
      console.error("[review] 调用内部 API 保存失败:", e.message);
    }
  }

  const summary = {
    totalAccounts: accountNames.length,
    successAccounts: successResults.length,
    totalItems: successResults.reduce((sum, r) => sum + (r.items || []).length, 0),
  };

  console.log(`\n[review] 抓取完成: ${summary.successAccounts}/${summary.totalAccounts} 账号成功，共 ${summary.totalItems} 条内容`);
}

main().catch((error) => {
  console.error("[review] 脚本执行失败:", error.message || error);
  process.exit(1);
});
