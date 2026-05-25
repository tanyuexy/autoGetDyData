require("dotenv").config();
// stdout 接到管道时默认会块缓冲，父进程难以及时收到逐行日志
try {
  if (
    process.stdout._handle &&
    typeof process.stdout._handle.setBlocking === "function"
  ) {
    process.stdout._handle.setBlocking(true);
  }
  if (
    process.stderr._handle &&
    typeof process.stderr._handle.setBlocking === "function"
  ) {
    process.stderr._handle.setBlocking(true);
  }
} catch (_) {}
const path = require("path");
const { startAndWaitInternalApiTask } = require("../common/internal-api-client");
const { chromium } = require("../common/stealth-browser");

const fse = require("fs-extra");
const {
  getAccountPaths,
  parseCliCommand,
  resolveAccountsToRun,
  splitAccountsByCreatorSettingsStatus,
  printAccountExecutionSummary,
  printExportChannelSummary
} = require("./core/accounts");
const {
  BROWSER_VIEWPORT,
  HEADLESS
} = require("./core/env");
const { attachQrDataUrlSniffer } = require("./core/qr");
const { openTargetAndEnsureLogin, isLoggedInAtTarget } = require("./core/browser-login");
const { exportPostListData, saveAuth } = require("./export/exporter");
const { mergeExportFiles } = require("./export/merge");
const { runPublishArticle } = require("./publish/article");
const { runPublishVideo } = require("./publish/video");

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      i += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

let activeBrowser = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，正在关闭抖创浏览器...`);
  try {
    if (activeBrowser) await activeBrowser.close();
  } catch (error) {
    console.error("关闭抖创浏览器失败:", error.message || error);
  } finally {
    process.exit(signal === "SIGTERM" ? 143 : 130);
  }
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

async function runOneAccount(browser, accountName, command, options = {}) {
  const paths = getAccountPaths(accountName);
  await fse.ensureDir(paths.accountDir);
  await fse.ensureDir(paths.dataDir);
  await fse.ensureDir(paths.alertDir);

  const hasStoredAuth = await fse.pathExists(paths.storageStatePath);
  const useStoredAuth =
    typeof options.useStoredAuth === "boolean"
      ? options.useStoredAuth
      : command === "export" && hasStoredAuth;
  const forceManualLogin =
    typeof options.forceManualLogin === "boolean"
      ? options.forceManualLogin
      : command === "add";

  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    acceptDownloads: true,
    storageState: useStoredAuth ? paths.storageStatePath : undefined
  });
  let page = null;

  try {
    page = await context.newPage();
    attachQrDataUrlSniffer(page);
    console.log(
      `\n========== 开始处理账号: ${accountName} (${command}) ==========`
    );

    await openTargetAndEnsureLogin(page, paths, accountName, {
      hasStoredAuth,
      forceManualLogin,
      manualLoginReason: options.manualLoginReason,
      sendLoginAlerts: options.sendLoginAlerts,
      context,
    });

    if (command === "login") {
      console.log(`========== 登录完成: ${accountName} ==========\n`);
      return { accountName, ok: true };
    }

    const exportFilePath = await exportPostListData(page, paths, accountName);

    if (context && page && !page.isClosed()) {
      const stillLoggedIn = await isLoggedInAtTarget(page).catch(() => false);
      if (stillLoggedIn) {
        try {
          await saveAuth(context, paths, accountName, {
            verifiedDetail: "导出任务完成后刷新登录态"
          });
        } catch (saveError) {
          console.warn(
            `账号 [${accountName}] 导出成功但刷新登录态失败:`,
            saveError.message || saveError
          );
        }
      }
    }

    console.log(`========== 账号完成: ${accountName} ==========\n`);
    return { accountName, ok: true, exportFilePath };
  } catch (error) {
    console.error(`账号 [${accountName}] 执行失败:`, error.message || error);
    return { accountName, ok: false, error: error.message || String(error) };
  } finally {
    await context.close();
  }
}

async function runAccountQueue(browser, accounts, command, options = {}) {
  const results = [];
  for (const accountName of accounts) {
    results.push(await runOneAccount(browser, accountName, command, options));
  }
  return results;
}

async function runFeishuSyncDataXlsxCreator() {
  console.log("调用 Next API 同步抖创数据到飞书多维表格...");
  await startAndWaitInternalApiTask(
    "/api/feishu/sync",
    { profile: "creator" },
    { timeoutMs: 30 * 60 * 1000 }
  );
}

async function main() {
  const directCommand = (process.argv[2] || "").toLowerCase();
  if (directCommand === "publish-article") {
    const options = parseArgs(process.argv.slice(3));
    await runPublishArticle(options);
    return;
  }
  if (directCommand === "publish-video") {
    const options = parseArgs(process.argv.slice(3));
    await runPublishVideo(options);
    return;
  }

  const parsed = parseCliCommand();
  const { command, accountName, exportAccountFilters } = parsed;
  const accounts = await resolveAccountsToRun(
    command,
    accountName,
    exportAccountFilters
  );

  const shouldSyncFeishuAfterExport = command === "export:feishu";

  console.log(`当前命令: ${command}`);
  console.log(`本次将处理 ${accounts.length} 个账号: ${accounts.join(", ")}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized"]
  });
  activeBrowser = browser;

  if (command === "login") {
    const loginMode = String(process.env.CREATOR_LOGIN_MODE || "email_qr").trim().toLowerCase();
    const sendLoginAlerts = loginMode !== "local_manual";
    const results = await runAccountQueue(browser, accounts, "login", {
      useStoredAuth: false,
      forceManualLogin: true,
      manualLoginReason: "手动触发账号登录",
      sendLoginAlerts
    });
    await browser.close();
    activeBrowser = null;

    printAccountExecutionSummary(results);
    return;
  }

  const { withAuth, withoutAuth } = splitAccountsByCreatorSettingsStatus(accounts);
  printExportChannelSummary(withAuth, withoutAuth);

  // 串行执行两路队列，避免并行 console 交错导致「开始处理账号 A」与「账号 B 无登录态」粘在一起
  const authResults = await runAccountQueue(browser, withAuth, "export", {
    useStoredAuth: true,
    forceManualLogin: false
  });
  if (withoutAuth.length > 0) {
    console.log("\n---------- 开始处理：需登录验证的账号 ----------\n");
  }
  const loginResults = await runAccountQueue(browser, withoutAuth, "export", {
    useStoredAuth: false,
    forceManualLogin: true,
    manualLoginReason: "需先完成登录验证"
  });

  const results = [...authResults, ...loginResults];
  await browser.close();
  activeBrowser = null;

  const { allSuccess } = printAccountExecutionSummary(results);

  let mergedPath = null;
  try {
    mergedPath = await mergeExportFiles(results, {
      requireAllSuccess: shouldSyncFeishuAfterExport
    });
  } catch (error) {
    console.error("抖创数据汇总失败:", error.message || error);
    if (shouldSyncFeishuAfterExport) {
      console.log("存在失败店铺或汇总失败，已跳过写入飞书多维表格。");
      return;
    }
  }

  if (shouldSyncFeishuAfterExport && allSuccess && mergedPath) {
    console.log("全部店铺导出成功，开始写入飞书多维表格...");
    await runFeishuSyncDataXlsxCreator();
  } else if (shouldSyncFeishuAfterExport) {
    console.log("存在失败店铺，已跳过写入飞书多维表格。");
  }
}

main().catch((error) => {
  console.error("\n脚本执行失败:", error);
  process.exitCode = 1;
});
