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
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");

const { ensureDir, fileExists } = require("../common/fs");
const {
  getAccountPaths,
  parseCliCommand,
  resolveAccountsToRun,
  splitAccountsByStorageState
} = require("./lib/accounts");
const {
  BROWSER_VIEWPORT,
  LOGIN_VERIFY_METHOD,
  HEADLESS
} = require("./lib/env");
const { attachQrDataUrlSniffer } = require("./lib/qr");
const { openTargetAndEnsureLogin } = require("./lib/login");
const { saveAuth, exportPostListData } = require("./lib/exporter");
const { mergeExportFiles } = require("./lib/merge-exports");
const {
  printAccountExecutionSummary,
  printExportChannelSummary
} = require("./lib/index-helpers");
const { parseArgs } = require("./publish/utils");
const { runPublishArticle } = require("./publish/article");
const { runPublishVideo } = require("./publish/video");

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
  await ensureDir(paths.accountDir);
  await ensureDir(paths.dataDir);
  await ensureDir(paths.alertDir);

  const hasStoredAuth = await fileExists(paths.storageStatePath);
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

  try {
    const page = await context.newPage();
    attachQrDataUrlSniffer(page);
    console.log(
      `\n========== 开始处理账号: ${accountName} (${command}) ==========`
    );

    await openTargetAndEnsureLogin(page, paths, accountName, {
      hasStoredAuth,
      forceManualLogin,
      manualLoginReason: options.manualLoginReason
    });

    await saveAuth(context, paths, accountName);

    if (command === "login") {
      console.log(`========== 登录完成: ${accountName} ==========\n`);
      return { accountName, ok: true };
    }

    const exportFilePath = await exportPostListData(page, paths, accountName);
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

function runFeishuSyncDataXlsxCreator() {
  const projectRoot = path.resolve(__dirname, "../..");
  const result = spawnSync(
    process.execPath,
    ["scripts/run.js", "feishu:sync-creator"],
    {
      cwd: projectRoot,
      stdio: "inherit",
      env: { ...process.env },
      shell: false
    }
  );

  if (result.status !== 0) {
    throw new Error(
      `写入飞书多维表格失败，退出码: ${
        result.status == null ? "unknown" : result.status
      }`
    );
  }
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
    const results = await runAccountQueue(browser, accounts, "login", {
      useStoredAuth: false,
      forceManualLogin: true,
      manualLoginReason: "手动触发账号登录"
    });
    await browser.close();
    activeBrowser = null;

    printAccountExecutionSummary(results);
    return;
  }

  const { withAuth, withoutAuth } = await splitAccountsByStorageState(accounts);
  printExportChannelSummary(withAuth, withoutAuth, LOGIN_VERIFY_METHOD);

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
    runFeishuSyncDataXlsxCreator();
  } else if (shouldSyncFeishuAfterExport) {
    console.log("存在失败店铺，已跳过写入飞书多维表格。");
  }
}

main().catch((error) => {
  console.error("\n脚本执行失败:", error);
  process.exitCode = 1;
});
