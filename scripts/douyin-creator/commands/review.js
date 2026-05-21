/**
 * 稿文作品信息抓取脚本
 * 登录抖音创作者平台，通过页面拦截 API 响应抓取作品列表（含抖音链接）
 *
 * 用法:
 *   node scripts/douyin-creator/commands/review.js 账号A 账号B
 *   或通过环境变量 REVIEW_ACCOUNTS=账号A,账号B 指定
 */

const path = require("path");
const crypto = require("crypto");
const { chromium } = require("../../common/stealth-browser");
const fse = require("fs-extra");
const { getAccountPaths } = require("../core/accounts");
const { BROWSER_VIEWPORT, HEADLESS } = require("../core/env");
const { openTargetAndEnsureLogin } = require("../core/browser-login");
const { setPostListDateRange } = require("../export/exporter");

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
  if (status === 5) return "needs_optimization";
  if (status === 6) return "rejected"; // 限制传播/仅好友可见
  return "under_review";
}

/** 审核未通过的文本关键词，用于从拒绝原因文本反推状态 */
const REJECTION_TEXT_PATTERNS = [
  /审核有误/,
  /审核不通过/,
  /未通过审核/,
  /审核未通过/,
  /违规/,
  /违规原因/,
  /含有违规/,
  /不可发布/,
  /已被拒绝/,
  /驳回/,
  /不适宜/,
  /禁止发布/,
  /不予通过/,
  /下架/,
  /已被下架/,
  /限制互关可见/,
  /仅好友可见/,
  /低俗/,
  /色情/,
];

function textIndicatesRejection(reasonText) {
  if (!reasonText) return false;
  return REJECTION_TEXT_PATTERNS.some((p) => p.test(reasonText));
}

function buildWorkLink(postId) {
  return `https://www.douyin.com/video/${postId}`;
}

function normalizeItem(item) {
  const postId = String(item?.id || "").trim();
  if (!postId) return null;

  const reviewStatus = inferReviewStatus(item);
  // 只有已发布和需优化状态的作品才有公开链接，其他状态链接无效
  const workLink = (reviewStatus === "approved" || reviewStatus === "needs_optimization")
    ? buildWorkLink(postId)
    : "";

  return {
    postId,
    userId: String(item?.user_id || ""),
    title: String(item?.description || "").trim(),
    publishDate: formatUnixSeconds(item?.create_time) || new Date().toISOString(),
    reviewStatus,
    workLink,
    workType: item?.type === 2 ? "视频" : item?.type === 1 ? "图文" : "",
    coverUrl: (item?.cover?.url_list && item.cover.url_list[0]) || undefined,
  };
}

/**
 * 解析 review/result API 返回的违规原因字段，提取完整描述
 */
function parseReviewReasons(fields) {
  const parts = [];
  for (const field of fields) {
    if (field.type === "multi_reason_detail" || field.type === "reason_detail") {
      try {
        const reasons = JSON.parse(field.value);
        for (const r of reasons) {
          const brief = r.brief || "";
          const detail = r.detail || "";
          if (brief && detail) {
            parts.push(`【${brief}】${detail}`);
          } else if (brief) {
            parts.push(brief);
          } else if (detail) {
            parts.push(detail);
          }
          if (r.suggestion) {
            parts.push(`修改建议：${r.suggestion}`);
          }
        }
      } catch (_) {}
    }
  }
  return parts.join(" | ") || null;
}

/**
 * 通过 review/result API 获取单条作品的完整审核详情
 */
async function fetchReviewResult(page, userId, postId) {
  try {
    const params = new URLSearchParams({
      user_id: userId,
      object_id: postId,
      scene: "73",
      from_message: "false",
      app_source: "0",
      enter_from: "scene_73",
      item_appeal_id: "0",
      music_appeal_id: "0",
      hide_nav_bar: "1",
      hybrid_sdk_version: "bullet",
      use_bdx: "1",
      should_full_screen: "1",
      sdkScene: "creator",
      visit_platform: "creator",
    });
    const text = await page.evaluate(async (url) => {
      const r = await fetch(url);
      return await r.text();
    }, `/aweme/v1/review/result/?${params.toString()}`);

    const json = JSON.parse(text);
    if (json?.status_code !== 0) return null;

    const fields = json?.review_detail?.fields || [];
    return parseReviewReasons(fields);
  } catch (e) {
    console.warn(`[review] 获取作品 ${postId} 审核详情失败: ${e.message}`);
    return null;
  }
}

/**
 * 通过 item/mget API 批量获取非通过作品的拒绝/优化原因，
 * 并进一步通过 review/result API 获取完整审核详情
 */
async function fetchRejectionReasons(page, items) {
  const nonApproved = items.filter((i) => i.reviewStatus !== "approved");
  if (nonApproved.length === 0) return;

  console.log(`[review] 正在获取 ${nonApproved.length} 条非通过作品的拒绝原因...`);
  const batchSize = 20;
  let filled = 0;

  // 第一步：通过 item/mget 获取简要原因和 userId
  for (let i = 0; i < nonApproved.length; i += batchSize) {
    const batch = nonApproved.slice(i, i + batchSize);
    const ids = batch.map((it) => it.postId).join(",");
    try {
      const resp = await page.evaluate(async (url) => {
        const r = await fetch(url);
        const text = await r.text();
        // 作品 ID 超出 JS 安全整数范围，先将数字 ID 转为字符串再解析
        const fixed = text.replace(/"id":(\d{15,25})/g, '"id":"$1"');
        return JSON.parse(fixed);
      }, `/web/api/creator/item/mget?ids=${ids}&fields=review`);

      const apiItems = resp?.items || [];
      for (const apiItem of apiItems) {
        const postId = String(apiItem.id);
        const local = nonApproved.find((it) => it.postId === postId);
        if (!local) continue;
        // 补全 userId（item/list 中的 userId 可能更可靠）
        if (!local.userId && apiItem.user_id) {
          local.userId = String(apiItem.user_id);
        }
        const detail = apiItem?.review?.details?.[0];
        if (detail?.text) {
          local.rejectionReason = detail.text;
          filled++;
        }

        // 根据 mget 返回的更准确的 review.status 重新评估状态
        if (apiItem?.review?.status != null) {
          const corrected = inferReviewStatus(apiItem);
          if (corrected !== "under_review") {
            local.reviewStatus = corrected;
            // 修正为未通过时清除无效的作品链接
            if (corrected === "rejected") local.workLink = "";
          }
        }
        // 如果状态仍为审核中，但拒绝原因文本明确表示审核失败，修正为未通过
        if (local.reviewStatus === "under_review" && textIndicatesRejection(local.rejectionReason)) {
          local.reviewStatus = "rejected";
          local.workLink = "";
        }
      }
    } catch (e) {
      console.warn(`[review] 获取拒绝原因批次失败 (${i}-${i + batch.length}): ${e.message}`);
    }
  }

  console.log(`[review] 简要原因已填充 ${filled}/${nonApproved.length} 条`);

  // 第二步：通过 review/result API 获取每条非通过作品的完整审核详情
  let enrichedCount = 0;
  for (const item of nonApproved) {
    if (!item.userId) continue;
    const fullReason = await fetchReviewResult(page, item.userId, item.postId);
    if (fullReason) {
      item.rejectionReason = fullReason;
      enrichedCount++;
    } else {
      console.warn(`[review] 作品 ${item.postId} 未获取到完整审核详情，保留简要原因`);
    }
    // 完整审核详情也可能揭示真实审核状态
    if (item.reviewStatus === "under_review" && textIndicatesRejection(item.rejectionReason)) {
      item.reviewStatus = "rejected";
      item.workLink = "";
    }
    // 避免请求过于频繁
    await page.waitForTimeout(500);
  }

  console.log(`[review] 完整原因已填充 ${enrichedCount}/${nonApproved.length} 条`);
}

/**
 * 等待投稿列表页面加载完成，然后切换到"投稿列表"tab，
 * 通过拦截页面自身的 API 响应来收集所有作品数据。
 * @param {import('playwright').Page} page
 * @param {{ startYmd: string, endYmd: string }} [dateRange] 自定义日期范围
 */
async function fetchAllItemsFromPage(page, dateRange) {
  return new Promise(async (resolve, reject) => {
    const collected = new Map();
    let done = false;
    let error = null;

    // 如果传入了自定义日期范围，拦截 API 请求替换 start_time/end_time
    if (dateRange) {
      const startMs = new Date(dateRange.startYmd + "T00:00:00+08:00").getTime();
      const endMs = new Date(dateRange.endYmd + "T23:59:59+08:00").getTime();
      await page.route("**/item/list**", async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.has("start_time")) {
          url.searchParams.set("start_time", String(startMs));
          url.searchParams.set("end_time", String(endMs));
          await route.continue({ url: url.toString() });
        } else {
          await route.continue();
        }
      });
    }

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
      try {
        await page.unroute("**/item/list**");
      } catch (_) {}
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
  await fse.ensureDir(paths.accountDir);
  await fse.ensureDir(paths.dataDir);

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
      sendLoginAlerts: true,
      context,
    });

    await page.goto(CONTENT_PAGE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);

    const reviewDateStart = process.env.REVIEW_DATE_START || "";
    const reviewDateEnd = process.env.REVIEW_DATE_END || "";
    const hasDateRange = Boolean(reviewDateStart && reviewDateEnd);
    const dateRangeMsg = hasDateRange
      ? `${reviewDateStart} ~ ${reviewDateEnd}（自定义）`
      : "默认 90 天";
    console.log(`[review] 账号 ${accountName} 设置发布时间范围: ${dateRangeMsg}`);
    let dateRange;
    try {
      const dateOpts = hasDateRange
        ? { startDate: reviewDateStart, endDate: reviewDateEnd }
        : { defaultStartDaysAgo: 90 };
      dateRange = await setPostListDateRange(page, accountName, dateOpts);
      console.log(`[review] 账号 ${accountName} 日期范围: ${dateRange.startYmd} ~ ${dateRange.endYmd}`);
    } catch (e) {
      console.warn(`[review] 账号 ${accountName} 设置日期范围失败，将继续使用页面默认范围: ${e.message}`);
    }

    console.log(`[review] 账号 ${accountName} 拦截页面 API 响应抓取作品列表`);
    const items = await fetchAllItemsFromPage(page, dateRange);
    console.log(`[review] 账号 ${accountName} 共抓取 ${items.length} 条作品`);

    await fetchRejectionReasons(page, items);

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
    const { listAccountDirs } = require("../core/accounts");
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
      const { postInternalApi } = require("../../common/internal-api-client");
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
