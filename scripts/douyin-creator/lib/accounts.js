const fs = require("fs/promises");
const path = require("path");
const { ensureDir, fileExists } = require("../../common/fs");
const { ACCOUNTS_DIR } = require("./env");

function normalizeAccountName(name) {
  return String(name || "").trim().replace(/[\\/:*?"<>|]/g, "_");
}

function getAccountPaths(accountName) {
  const accountDir = path.join(ACCOUNTS_DIR, accountName);
  return {
    accountDir,
    storageStatePath: path.join(accountDir, "storageState.json"),
    cookiesPath: path.join(accountDir, "cookies.json"),
    dataDir: path.join(accountDir, "data"),
    alertDir: path.join(accountDir, "alerts")
  };
}

async function listAccountDirs() {
  await ensureDir(ACCOUNTS_DIR);
  const entries = await fs.readdir(ACCOUNTS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function parseCliCommand() {
  const args = process.argv.slice(2);
  const command = (args[0] || "export").toLowerCase();
  if (!["export", "export:feishu", "login"].includes(command)) {
    throw new Error(
      "只支持: export / export:feishu / login。页面任务请通过 Web 界面触发；脚本入口示例: node scripts/run.js creator:export / node scripts/run.js creator:export-feishu / node scripts/run.js creator:login 账号A"
    );
  }
  const tail = args.slice(1);
  if (command === "export" || command === "export:feishu" || command === "login") {
    const exportAccountFilters = tail
      .map((s) => normalizeAccountName(s))
      .filter(Boolean);
    return { command, exportAccountFilters };
  }
  const accountName = normalizeAccountName(tail.join(" ").trim());
  return { command, accountName };
}

async function resolveAccountsToRun(
  command,
  accountNameFromArg,
  exportAccountFilters
) {
  const existingAccounts = await listAccountDirs();

  if (existingAccounts.length === 0) {
    throw new Error(
      "export 模式未发现账号目录。请先完成扫码登录创建账号目录。"
    );
  }
  if (!exportAccountFilters || exportAccountFilters.length === 0) {
    return existingAccounts;
  }

  const existingSet = new Set(existingAccounts);
  const missing = [];
  const selected = [];
  const seen = new Set();
  for (const name of exportAccountFilters) {
    if (!existingSet.has(name)) {
      missing.push(name);
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    selected.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `export 指定的账号在 accounts 下无对应目录: ${missing.join(
        ", "
      )}。当前已有: ${existingAccounts.join(", ")}`
    );
  }
  return selected;
}

async function splitAccountsByStorageState(accounts) {
  const withAuth = [];
  const withoutAuth = [];
  for (const accountName of accounts) {
    const paths = getAccountPaths(accountName);
    const hasStorage = await fileExists(paths.storageStatePath);
    if (hasStorage) {
      withAuth.push(accountName);
    } else {
      withoutAuth.push(accountName);
    }
  }
  return { withAuth, withoutAuth };
}

module.exports = {
  normalizeAccountName,
  getAccountPaths,
  listAccountDirs,
  parseCliCommand,
  resolveAccountsToRun,
  splitAccountsByStorageState
};

