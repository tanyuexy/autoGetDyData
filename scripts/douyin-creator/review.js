/**
 * 稿文作品信息抓取脚本
 * 登录抖音创作者平台，通过页面拦截 API 响应抓取作品列表（含抖音链接）
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
const { openTargetAndEnsureLogin } = require("./lib/login");
const { saveAuth } = require("./lib/exporter");

const CONTENT_PAGE_URL = "https://creator.douyin.com/creator-micro/data-center/content";

function shortHash(input) {
  return crypto.createHash("sha1").update(String(input || "")).digest("hex").slice(0, 16);
}

function formatUnixSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "";
  const d = new Date(n * 1000);
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function inferReviewStatus(item) {
  const status = item?.review?.status;
  if (status === 2) return "approved";
  if (status === 3) return "rejected";
  return "under_review";
}

function buildWorkLink(postId) {
  return `https://www.douyin.com/video/${postId}`;
}

function normalizeItem(item) {
  const postId = String(item?.id || "").trim();
  if (!postId) return null;

  return {
    postId,
    title: String(item?.description || "").trim(),
    publishDate: formatUnixSeconds(item?.create_time) || new Date().toISOString(),
    reviewStatus: inferReviewStatus(item),
    workLink: buildWorkLink(postId),
    workType: item?.type === 2 ? "视频" : item?.type === 1 ? "图文" : "",
    coverUrl: (item?.cover?.url_list && item.cover.url_list[0]) || undefined,
  };
}

/**
 * 等待投稿列表页面加载完成，然后切换到"投稿列表"tab，
 * 通过拦截页面自身的 API 响应来收集所有作品数据。
 */
async function fetchAllItemsFromPage(page) {
  return new Promise(async (resolve, reject) => {
    const collected = new Map();
    let done = false;
    let error = null;

    const onResponse = async (response) => {
      if (done) return;
      const url = response.url();
      if (!url.includes("/web/api/creator/item/list")) return;

      try {
        const json = await response.json();
        if (json?.status_code !== 0) return;

        const items = Array.isArray(json.items) ? json.items : [];
        for (const raw of items) {
          const item = normalizeItem(raw);
          if (!item) continue;
          if (!collected.has(item.postId)) {
            collected.set(item.postId, item);
            // 打印前几条便于调试
            if (collected.size <= 3) {
              console.log(`[review] 示例作品: id=${item.postId} link=${item.workLink} title=${item.title.slice(0, 40)}`);
            }
          }
        }

        console.log(`[review] 拦截响应: 本页 ${items.length} 条, 累计 ${collected.size} 条, has_more=${json.has_more}`);

        if (!json.has_more || items.length === 0) {
          done = true;
        }
      } catch (e) {
        // 跳过解析失败
      }
    };

    page.on("response", onResponse);

    // 滚动加载更多，最多等 2 分钟
    const deadline = Date.now() + 120000;
    let idleRounds = 0;
    let lastCount = 0;

    async function scrollLoop() {
      while (Date.now() < deadline && !done) {
        await page.evaluate(() => {
          const delta = window.innerHeight * 0.7;
          window.scrollBy(0, delta);
        });
        await page.waitForTimeout(1800);

        if (collected.size === lastCount) {
          idleRounds++;
        } else {
          idleRounds = 0;
          lastCount = collected.size;
        }

        // 连续 4 轮没有新数据且 lastCount > 0，认为已全部加载
        if (idleRounds >= 4 && lastCount > 0) {
          console.log(`[review] 连续 ${idleRounds} 轮无新数据，停止滚动`);
          break;
        }
      }
    }

    try {
      // 等待投稿作品 tab 可见
      await page.getByText("投稿作品", { exact: true }).first().waitFor({ timeout: 15000 });

      // 切换到"投稿列表"
      const listRadio = page.locator("span").filter({ hasText: "投稿列表" }).first();
      await listRadio.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);

      // 等待至少拉取到第一批数据
      await page.waitForResponse(
        (resp) => resp.url().includes("/web/api/creator/item/list") && resp.status() === 200,
        { timeout: 30000 }
      ).catch(() => {});

      // 再等一下确保数据已进入 collected
      await page.waitForTimeout(2000);

      await scrollLoop();
    } catch (e) {
      error = e;
    } finally {
      page.off("response", onResponse);
    }

    if (error && collected.size === 0) {
      reject(error);
    } else {
      const items = Array.from(collected.values());
      resolve(items);
    }
  });
}

async function scrapeReviewForAccount(browser, accountName) {
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

    await page.goto(CONTENT_PAGE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);

    console.log(`[review] 账号 ${accountName} 拦截页面 API 响应抓取作品列表`);
    const items = await fetchAllItemsFromPage(page);
    console.log(`[review] 账号 ${accountName} 共抓取 ${items.length} 条作品`);

    const statusCounts = items.reduce((acc, item) => {
      acc[item.reviewStatus] = (acc[item.reviewStatus] || 0) + 1;
      return acc;
    }, {});
    console.log(`[review] 账号 ${accountName} 状态统计: ${JSON.stringify(statusCounts)}`);
    const withLinkCount = items.filter((i) => i.workLink).length;
    console.log(`[review] 账号 ${accountName} 有链接作品: ${withLinkCount} 条`);

    // 打印几个链接样例
    const samples = items.filter((i) => i.workLink).slice(0, 5);
    for (const s of samples) {
      console.log(`[review]   链接样例: ${s.workLink}  ${s.title.slice(0, 50)}`);
    }

    return { accountName, ok: true, items };
  } catch (error) {
    console.error(`[review] 账号 ${accountName} 抓取失败:`, error.message || error);
    return { accountName, ok: false, error: error.message || String(error), items: [] };
  } finally {
    await context.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let accountNames = [];
  for (const arg of args) {
    if (arg.startsWith("--")) continue;
    if (arg) accountNames.push(arg);
  }

  if (accountNames.length === 0 && process.env.REVIEW_ACCOUNTS) {
    accountNames = process.env.REVIEW_ACCOUNTS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (accountNames.length === 0) {
    const { listAccountDirs } = require("./lib/accounts");
    accountNames = await listAccountDirs();
  }

  if (accountNames.length === 0) {
    console.error("[review] 未找到可用账号");
    process.exit(1);
  }

  console.log(
    `[review] 将处理 ${accountNames.length} 个账号: ${accountNames.join(", ")}`
  );

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized"],
  });

  const allResults = [];

  try {
    for (const accountName of accountNames) {
      const result = await scrapeReviewForAccount(browser, accountName);
      allResults.push(result);
    }
  } finally {
    await browser.close();
  }

  const successResults = allResults.filter((r) => r.ok);
  if (successResults.length > 0) {
    try {
      const { postInternalApi } = require("../common/internal-api-client");
      const saveResult = await postInternalApi("/api/review/save", { results: successResults });
      console.log(`[review] 已通过内部 API 保存 ${saveResult.saved || 0} 条作品记录到 MongoDB`);
    } catch (e) {
      console.error("[review] 调用内部 API 保存失败:", e.message);
    }
  }

  const summary = {
    totalAccounts: accountNames.length,
    successAccounts: successResults.length,
    totalItems: successResults.reduce((sum, r) => sum + (r.items || []).length, 0),
  };

  console.log(`\n[review] 抓取完成: ${summary.successAccounts}/${summary.totalAccounts} 账号成功，共 ${summary.totalItems} 条作品`);
}

main().catch((error) => {
  console.error("[review] 脚本执行失败:", error.message || error);
  process.exit(1);
});
