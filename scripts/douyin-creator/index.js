require("dotenv").config();
const { chromium } = require("playwright");

const { ensureDir, fileExists } = require("./lib/fs-utils");
const {
  getAccountPaths,
  parseCliCommand,
  resolveAccountsToRun,
  splitAccountsByStorageState
} = require("./lib/accounts");
const { BROWSER_VIEWPORT, LOGIN_VERIFY_METHOD } = require("./lib/env");
const { attachQrDataUrlSniffer } = require("./lib/qr");
const { openTargetAndEnsureLogin } = require("./lib/login");
const { saveAuth, exportPostListData } = require("./lib/exporter");
const { mergeExportFiles } = require("./lib/merge-exports");

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

async function main() {
  const parsed = parseCliCommand();
  const { command, accountName, exportAccountFilters } = parsed;
  const accounts = await resolveAccountsToRun(
    command,
    accountName,
    exportAccountFilters
  );

  if (command === "list") {
    console.log(`当前账号数量: ${accounts.length}`);
    if (accounts.length === 0) {
      console.log(
        "未找到账号目录。可先执行: npm run add -- 账号A 或 npm run add（按 config.json 批量建目录）"
      );
      return;
    }

    console.log("\n账号状态:");
    for (const name of accounts) {
      const paths = getAccountPaths(name);
      const hasStorage = await fileExists(paths.storageStatePath);
      const hasCookies = await fileExists(paths.cookiesPath);
      console.log(
        `- ${name} | storageState: ${
          hasStorage ? "yes" : "no"
        } | cookies: ${hasCookies ? "yes" : "no"}`
      );
    }
    return;
  }

  if (command === "add") {
    console.log(`当前命令: ${command}`);
    console.log(
      `本次将创建 ${accounts.length} 个账号目录: ${accounts.join(", ")}`
    );
    for (const name of accounts) {
      const paths = getAccountPaths(name);
      await ensureDir(paths.accountDir);
      console.log(`- 已创建: ${paths.accountDir}`);
    }
    console.log("\n登录与导出请使用: npm run export");
    return;
  }

  console.log(`当前命令: ${command}`);
  console.log(`本次将处理 ${accounts.length} 个账号: ${accounts.join(", ")}`);

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"]
  });

  const { withAuth, withoutAuth } = await splitAccountsByStorageState(accounts);
  console.log(`导出通道A(已有登录态): ${withAuth.length} 个账号`);
  console.log(`导出通道B(需登录验证): ${withoutAuth.length} 个账号`);
  console.log(
    `登录验证方式: ${
      LOGIN_VERIFY_METHOD === "sms"
        ? "发送短信验证"
        : LOGIN_VERIFY_METHOD === "receive_sms_code"
          ? "接收短信验证码(邮件回填)"
          : "二维码/默认流程"
    }`
  );

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

  const successCount = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok);
  console.log(`\n全部执行完成: 成功 ${successCount} / ${results.length}`);
  if (failed.length > 0) {
    console.log("失败账号:");
    for (const item of failed) {
      console.log(`- ${item.accountName}: ${item.error}`);
    }
  }
  await mergeExportFiles(results);
}

main().catch((error) => {
  console.error("\n脚本执行失败:", error);
  process.exitCode = 1;
});

