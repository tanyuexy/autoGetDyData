/**
 * 评论回复脚本
 * 以店铺身份在作品下发布评论
 *
 * 用法:
 *   node scripts/douyin-creator/commands/reply-comment.js --account=账号名 --aweme-id=xxx --text="回复内容"
 */

const { chromium } = require("../../common/stealth-browser");
const { getAccountPaths } = require("../core/accounts");
const { BROWSER_VIEWPORT, HEADLESS } = require("../core/env");
const { openTargetAndEnsureLogin } = require("../core/browser-login");

const COMMENT_PAGE_URL = "https://creator.douyin.com/creator-micro/interactive/comment";

async function postReply(context, page, awemeId, text, replyToCid) {
  // Get the CSRF token from the page
  const csrfToken = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="x-secsdk-csrf-token"]');
    if (meta) return meta.getAttribute("content");
    const match = document.cookie.match(/csrf_token=([^;]+)/);
    return match ? match[1] : "";
  });

  if (!csrfToken) {
    throw new Error("无法获取 CSRF token");
  }

  const params = new URLSearchParams({
    aweme_id: awemeId,
    text: text,
    aid: "2906",
    device_platform: "webapp",
  });

  if (replyToCid) {
    // Reply to a specific comment
    params.set("reply_to_comment_ids", replyToCid);
    params.set("channel_id", "618");
  }

  const path = replyToCid
    ? "web/comment/multi_publish/"
    : "comment/publish/";
  const url = `https://creator.douyin.com/aweme/janus/creator/comment/aweme/v1/${path}?${params}`;

  const response = await context.request.post(url, {
    headers: {
      "x-secsdk-csrf-token": csrfToken,
      referer: COMMENT_PAGE_URL,
      "content-type": "application/json",
    },
  });

  if (!response.ok()) {
    throw new Error(`回复请求失败: HTTP ${response.status()}`);
  }

  const data = await response.json();
  if (data.status_code !== 0) {
    throw new Error(`回复失败: ${data.status_msg || JSON.stringify(data)}`);
  }

  return data;
}

async function replyCommentForAccount(browser, accountName, awemeId, text, replyToCid) {
  const paths = getAccountPaths(accountName);
  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    storageState: paths.storageStatePath,
  });
  let page = null;

  try {
    page = await context.newPage();
    console.log(`\n[reply] 开始处理账号: ${accountName} (${replyToCid ? "回复评论" : "店铺评论"})`);

    await openTargetAndEnsureLogin(page, paths, accountName, {
      hasStoredAuth: true,
      forceManualLogin: false,
      sendLoginAlerts: true,
      context,
    });

    // Navigate to comment page to get CSRF token
    console.log(`[reply] 导航到评论管理页面`);
    await page.goto(COMMENT_PAGE_URL, {
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

    // Post the reply
    const label = replyToCid ? "回复" : "评论";
    console.log(`[reply] 发布${label}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    const result = await postReply(context, page, awemeId, text, replyToCid);
    console.log(`[reply] ${label}发布成功: ${JSON.stringify(result)}`);

    return { accountName, ok: true, awemeId, text, replyToCid, result };
  } catch (error) {
    console.error(`[reply] 账号 ${accountName} 回复失败:`, error.message || error);
    return { accountName, ok: false, awemeId, text, replyToCid, error: error.message || String(error) };
  } finally {
    await context.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let accountName = "";
  let awemeId = "";
  let text = "";
  let replyToCid = "";

  for (const arg of args) {
    if (arg.startsWith("--account=")) {
      accountName = arg.slice("--account=".length).trim();
    } else if (arg.startsWith("--aweme-id=")) {
      awemeId = arg.slice("--aweme-id=".length).trim();
    } else if (arg.startsWith("--text=")) {
      text = arg.slice("--text=".length).trim();
    } else if (arg.startsWith("--reply-to-cid=")) {
      replyToCid = arg.slice("--reply-to-cid=".length).trim();
    }
  }

  // Also support env vars
  if (!accountName) accountName = (process.env.REPLY_ACCOUNT || "").trim();
  if (!awemeId) awemeId = (process.env.REPLY_AWEME_ID || "").trim();
  if (!text) text = (process.env.REPLY_TEXT || "").trim();
  if (!replyToCid) replyToCid = (process.env.REPLY_TO_CID || "").trim();

  if (!accountName || !awemeId || !text) {
    console.error("[reply] 缺少必要参数: --account, --aweme-id, --text");
    process.exit(1);
  }

  console.log(`[reply] 账号: ${accountName}, 作品: ${awemeId}, 内容: ${text.substring(0, 50)}...`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized"],
  });

  try {
    const result = await replyCommentForAccount(browser, accountName, awemeId, text, replyToCid);
    if (!result.ok) {
      process.exit(1);
    }
    console.log(JSON.stringify({ success: true, accountName, awemeId }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[reply] 脚本执行失败:", error.message || error);
  process.exit(1);
});
