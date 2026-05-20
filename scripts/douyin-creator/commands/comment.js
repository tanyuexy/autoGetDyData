/**
 * 评论抓取脚本
 * 登录抖音创作者平台，通过 API 抓取作品评论
 *
 * 用法:
 *   node scripts/douyin-creator/commands/comment.js [--max-works=10] 账号A 账号B
 *   或通过环境变量 ACCOUNTS=账号A,账号B 指定
 */

const path = require("path");
const { chromium } = require("../../common/stealth-browser");
const { ensureDir } = require("../../common/fs");
const { getAccountPaths } = require("../core/accounts");
const { BROWSER_VIEWPORT, HEADLESS } = require("../core/env");
const { openTargetAndEnsureLogin } = require("../core/browser-login");
const { postInternalApi } = require("../../common/internal-api-client");

const COMMENT_TARGET_URL = "https://creator.douyin.com/creator-micro/interactive/comment";

async function fetchCommentsForAccount(browser, accountName, maxWorks) {
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
    console.log(`\n[comment] 开始处理账号: ${accountName}`);

    await openTargetAndEnsureLogin(page, paths, accountName, {
      hasStoredAuth: true,
      forceManualLogin: false,
      sendLoginAlerts: true,
      context,
    });

    // Navigate to comment page
    console.log(`[comment] 导航到评论管理页面`);
    await page.goto(COMMENT_TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);

    // Dismiss any dialog
    const dismissBtn = page.getByRole("button", { name: "我知道了" });
    if (await dismissBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dismissBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Fetch works via API
    console.log(`[comment] 获取作品列表`);
    const listData = await page.evaluate(async () => {
      const resp = await fetch(
        "https://creator.douyin.com/aweme/v1/creator/item/list?cursor=&aid=2906",
        { credentials: "include" }
      );
      return resp.json();
    });

    const items = (listData.item_info_list || []).slice(0, maxWorks);
    console.log(`[comment] 共获取到 ${items.length} 个作品 (最多${maxWorks}个)`);

    const works = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const awemeId = item.item_id_plain;
      const title = item.title || "";
      const commentCount = item.comment_count || 0;
      const createTime = item.create_time || "";

      let allComments = [];

      if (commentCount > 0) {
        // Fetch all comments with pagination
        allComments = await page.evaluate(async (awemeId) => {
          const comments = [];
          let cursor = 0;
          let hasMore = true;

          while (hasMore) {
            const url = `https://creator.douyin.com/web/api/third_party/aweme/api/comment/read/aweme/v1/web/comment/list/select/?aweme_id=${awemeId}&cursor=${cursor}&count=20&comment_select_options=0&sort_options=0&channel_id=618&app_id=2906&aid=2906&device_platform=webapp`;
            const resp = await fetch(url, { credentials: "include" });
            const data = await resp.json();

            if (data.status_code !== 0) break;

            const list = data.comments || [];
            comments.push(...list);
            hasMore = data.has_more || false;
            cursor = data.cursor || 0;
            if (list.length === 0) break;
          }

          return comments;
        }, awemeId);

        console.log(`[comment] 作品 ${i + 1}: "${title.substring(0, 30)}..." ${commentCount}条评论, 抓取到 ${allComments.length} 条`);
      } else {
        console.log(`[comment] 作品 ${i + 1}: "${title.substring(0, 30)}..." 无评论`);
      }

      works.push({
        aweme_id: awemeId,
        title,
        create_time: createTime,
        comment_count: commentCount,
        comments: allComments.map((c) => ({
          cid: c.cid || "",
          text: c.text || "",
          user: c.user?.nickname || "",
          user_id: c.user?.uid || "",
          like_count: c.digg_count || 0,
          reply_count: c.reply_comment_total || 0,
          create_time: c.create_time
            ? new Date(c.create_time * 1000).toISOString()
            : "",
          status: c.status,
        })),
      });
    }

    console.log(`[comment] 账号 ${accountName} 抓取完成，共 ${works.length} 个作品，${works.reduce((s, w) => s + w.comments.length, 0)} 条评论`);
    return { accountName, ok: true, works };
  } catch (error) {
    console.error(`[comment] 账号 ${accountName} 抓取失败:`, error.message || error);
    return { accountName, ok: false, error: error.message || String(error), works: [] };
  } finally {
    await context.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let maxWorks = 10;
  const accountNames = [];

  for (const arg of args) {
    if (arg.startsWith("--max-works=")) {
      maxWorks = Number(arg.slice("--max-works=".length)) || 10;
      continue;
    }
    if (arg) accountNames.push(arg);
  }

  // Support env var
  if (accountNames.length === 0 && process.env.COMMENT_ACCOUNTS) {
    accountNames.push(
      ...process.env.COMMENT_ACCOUNTS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }

  if (accountNames.length === 0) {
    const { listAccountDirs } = require("../core/accounts");
    const all = await listAccountDirs();
    accountNames.push(...(all || []));
  }

  if (accountNames.length === 0) {
    console.error("[comment] 未找到可用账号");
    process.exit(1);
  }

  console.log(
    `[comment] 将处理 ${accountNames.length} 个账号: ${accountNames.join(", ")}, 每个最多 ${maxWorks} 个作品`
  );

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized"],
  });

  const allResults = [];

  try {
    for (const accountName of accountNames) {
      const result = await fetchCommentsForAccount(browser, accountName, maxWorks);
      allResults.push(result);
    }
  } finally {
    await browser.close();
  }

  // Save to MongoDB via internal API
  const successResults = allResults.filter((r) => r.ok);
  if (successResults.length > 0) {
    try {
      const saveResult = await postInternalApi("/api/comment/save", {
        results: successResults,
      });
      console.log(
        `[comment] 已通过内部 API 保存 ${saveResult.saved || 0} 条评论记录到 MongoDB`
      );
    } catch (e) {
      console.error("[comment] 调用内部 API 保存失败:", e.message);
    }
  }

  const summary = {
    totalAccounts: accountNames.length,
    successAccounts: successResults.length,
    totalWorks: successResults.reduce((s, r) => s + (r.works || []).length, 0),
    totalComments: successResults.reduce(
      (s, r) => s + (r.works || []).reduce((ws, w) => ws + (w.comments || []).length, 0),
      0
    ),
  };

  console.log(
    `\n[comment] 抓取完成: ${summary.successAccounts}/${summary.totalAccounts} 账号成功, ${summary.totalWorks} 个作品, ${summary.totalComments} 条评论`
  );
  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  console.error("[comment] 脚本执行失败:", error.message || error);
  process.exit(1);
});
