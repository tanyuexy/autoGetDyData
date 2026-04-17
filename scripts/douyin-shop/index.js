require("dotenv").config();

const path = require("path");
const fs = require("fs/promises");
const { chromium } = require("playwright");

const {
  BROWSER_VIEWPORT,
  ACCOUNTS_DIR,
  getDefaultAccounts
} = require("./lib/env");
const { runShopLogin, getAccountPaths } = require("./lib/login");

function parseArgs(argv) {
  // 支持 "login"（默认）或 "login <email> <password>"
  const args = argv.slice(2);
  const command = args[0] && !args[0].includes("@") ? args[0] : "login";
  const positional = args[0] && !args[0].includes("@") ? args.slice(1) : args;

  if (positional.length >= 2) {
    return {
      command,
      accounts: [{ email: positional[0], password: positional[1] }]
    };
  }
  if (positional.length === 1) {
    // 仅给了邮箱，沿用默认密码
    const defaults = getDefaultAccounts();
    const def = defaults.find((a) => a.email === positional[0]) || defaults[0];
    return {
      command,
      accounts: [{ email: positional[0], password: def?.password }]
    };
  }
  return { command, accounts: getDefaultAccounts() };
}

async function runOne(browser, account) {
  if (!account?.email || !account?.password) {
    throw new Error("账号 email/password 缺失");
  }
  const paths = getAccountPaths(account.email);
  const hasStorage = await fs
    .access(paths.storageStatePath)
    .then(() => true)
    .catch(() => false);

  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    storageState: hasStorage ? paths.storageStatePath : undefined
  });

  try {
    const result = await runShopLogin(context, account);
    return { account: account.email, ok: true, ...result };
  } catch (error) {
    console.error(
      `账号 [${account.email}] 执行失败: ${error.message || error}`
    );
    return {
      account: account.email,
      ok: false,
      error: error.message || String(error)
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const { command, accounts } = parseArgs(process.argv);

  if (command === "list") {
    const safeList = await fs.readdir(ACCOUNTS_DIR).catch(() => []);
    if (safeList.length === 0) {
      console.log(`账号目录 ${ACCOUNTS_DIR} 为空`);
      return;
    }
    console.log(`已保存账号 (${ACCOUNTS_DIR}):`);
    for (const name of safeList) {
      const stat = await fs
        .stat(path.join(ACCOUNTS_DIR, name))
        .catch(() => null);
      if (!stat?.isDirectory()) continue;
      const hasStorage = await fs
        .access(path.join(ACCOUNTS_DIR, name, "storageState.json"))
        .then(() => true)
        .catch(() => false);
      console.log(`- ${name} | storageState: ${hasStorage ? "yes" : "no"}`);
    }
    return;
  }

  console.log(
    `抖店登录：待处理账号 ${accounts.length} 个: ${accounts
      .map((a) => a.email)
      .join(", ")}`
  );

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"]
  });

  const results = [];
  for (const account of accounts) {
    results.push(await runOne(browser, account));
  }

  await browser.close();

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n完成: 成功 ${okCount} / ${results.length}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log("失败账号:");
    for (const item of failed) {
      console.log(`- ${item.account}: ${item.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("脚本执行失败:", error);
  process.exitCode = 1;
});
