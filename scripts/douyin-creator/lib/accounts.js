const fs = require("fs/promises");
const path = require("path");
const { ensureDir, fileExists } = require("./fs-utils");
const { ACCOUNTS_DIR, DEFAULT_ADD_ACCOUNTS_JSON } = require("./env");

function normalizeAccountName(name) {
  return String(name || "").trim().replace(/[\\/:*?"<>|]/g, "_");
}

async function loadDefaultAddAccountNames() {
  let raw;
  try {
    raw = await fs.readFile(DEFAULT_ADD_ACCOUNTS_JSON, "utf-8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(
        `未找到 ${DEFAULT_ADD_ACCOUNTS_JSON}。请创建该文件，或使用: npm run add -- 账号名`
      );
    }
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${DEFAULT_ADD_ACCOUNTS_JSON} 不是合法 JSON`);
  }
  let list = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (data && Array.isArray(data.accounts)) {
    list = data.accounts;
  } else {
    throw new Error(
      `${DEFAULT_ADD_ACCOUNTS_JSON} 格式应为 ["名称"] 或 {"accounts":["名称"]}`
    );
  }
  const names = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const n = normalizeAccountName(item);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  return names;
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
  if (!["add", "export", "export:feishu", "list"].includes(command)) {
    throw new Error(
      "只支持四种命令: add / export / export:feishu / list。示例: npm run add -- 账号A / npm run add / npm run export / npm run export:feishu / npm run export -- 账号A [账号B] / npm run export:feishu -- 账号A [账号B] / npm run list"
    );
  }
  const tail = args.slice(1);
  if (command === "export" || command === "export:feishu") {
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
  if (command === "list") {
    return existingAccounts;
  }
  if (command === "add") {
    if (accountNameFromArg) {
      return [accountNameFromArg];
    }
    const names = await loadDefaultAddAccountNames();
    if (names.length === 0) {
      throw new Error(
        `${DEFAULT_ADD_ACCOUNTS_JSON} 中没有有效账号名（需为非空字符串）`
      );
    }
    return names;
  }

  if (existingAccounts.length === 0) {
    throw new Error(
      "export 模式未发现账号目录。请先执行 add 命令完成扫码登录。"
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
  loadDefaultAddAccountNames,
  getAccountPaths,
  listAccountDirs,
  parseCliCommand,
  resolveAccountsToRun,
  splitAccountsByStorageState
};

