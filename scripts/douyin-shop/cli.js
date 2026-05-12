require("dotenv").config();

const fs = require("fs/promises");
const { chromium } = require("playwright");

const { BROWSER_VIEWPORT, HEADLESS, getDefaultAccounts } = require("./lib/env");
const { runShopLogin, getAccountPaths } = require("./lib/login");
const { loadPreferredShopNames } = require("./lib/shop-picker");
const {
  mergeAllShopExportsToData,
  validateShopExportFiles,
  calcDaysToExport
} = require("./lib/merge-shop-exports");
const {
  collectProcessedNamesIntoSet,
  buildRemainingTargetsResolver,
  printResultSummary
} = require("./lib/index-helpers");
const {
  listFailedItems,
  closeExportItemStore
} = require("./lib/export-item-store");
const {
  startAndWaitInternalApiTask
} = require("../common/internal-api-client");

let activeBrowser = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，正在关闭抖店浏览器...`);
  try {
    if (activeBrowser) await activeBrowser.close();
  } catch (error) {
    console.error("关闭抖店浏览器失败:", error.message || error);
  } finally {
    process.exit(signal === "SIGTERM" ? 143 : 130);
  }
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

function parseArgs(argv) {
  // 支持 "login"（默认）或 "login <email> <password>"
  const args = argv.slice(2);
  const command =
    args[0] && !args[0].includes("@") ? String(args[0]).toLowerCase() : "login";
  const positional = args[0] && !args[0].includes("@") ? args.slice(1) : args;

  if (
    command === "merge" ||
    command === "feishu-sync" ||
    command === "retry-failed"
  ) {
    return { command, accounts: [] };
  }

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

function parseSelectedShopNamesFromEnv() {
  const raw = process.env.SHOP_SELECTED_NAMES || "";
  return raw
    .split(",")
    .map((s) => String(s || "").trim())
    .filter(Boolean);
}

function parseTargetDatesFromEnv() {
  const raw = process.env.SHOP_EXPORT_TARGET_DATES || "";
  return raw
    .split(",")
    .map((s) => String(s || "").trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
}

function formatDateYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function calcDaysToExportFromTargetDates(targetDates) {
  const offsets = (Array.isArray(targetDates) ? targetDates : [])
    .map(offsetFromDataDate)
    .filter((n) => Number.isFinite(n));
  return offsets.length ? Math.max(...offsets) + 1 : 1;
}

async function resolveExportDatePlan() {
  const targetDates = uniq(parseTargetDatesFromEnv());
  if (targetDates.length > 0) {
    const daysToExport = calcDaysToExportFromTargetDates(targetDates);
    console.log(
      `使用手动选择的导出日期范围：${targetDates[0]} ~ ${targetDates[targetDates.length - 1]}，共 ${targetDates.length} 天`
    );
    return { daysToExport, targetDates };
  }

  let daysToExport = 1;
  try {
    daysToExport = await calcDaysToExport();
  } catch (e) {
    console.warn(`读取备份表失败（使用默认值 1 天）: ${e.message}`);
  }

  const targetDatesByRule = [];
  for (let offset = daysToExport - 1; offset >= 0; offset -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - 1 - offset);
    d.setHours(0, 0, 0, 0);
    targetDatesByRule.push(formatDateYmd(d));
  }
  return { daysToExport, targetDates: targetDatesByRule };
}

async function resolveTargetShopNames() {
  const selected = parseSelectedShopNamesFromEnv();
  if (selected.length > 0) return selected;
  return await loadPreferredShopNames();
}

function createExportBatchId() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
}

function parseDataDate(dataDate) {
  const match = String(dataDate || "")
    .trim()
    .match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function offsetFromDataDate(dataDate) {
  const date = parseDataDate(dataDate);
  if (!date) return null;
  const yesterday = startOfToday();
  yesterday.setDate(yesterday.getDate() - 1);
  const diff = Math.round((yesterday.getTime() - date.getTime()) / 86400000);
  return diff >= 0 ? diff : null;
}

function uniq(values) {
  return [
    ...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))
  ];
}

function getLatestResultsByAccount(results) {
  const latest = new Map();
  for (const item of Array.isArray(results) ? results : []) {
    if (!item?.account) continue;
    latest.set(item.account, item);
  }
  return [...latest.values()];
}

async function getRetryableFailedItems(runId, options = {}) {
  const failedItems = await listFailedItems({ runId });
  const retryableItems = failedItems;

  if (options.logSummary !== false && failedItems.length > 0) {
    console.log(
      `抖店失败项检查：runId=${runId}，失败 ${failedItems.length} 条，将全部纳入补跑`
    );
  }

  return { failedItems, retryableItems };
}

async function runFailedShopExportRetry(accounts, options = {}) {
  const requestedRunId = options.runId || process.env.SHOP_RETRY_RUN_ID;
  const failedItems =
    options.failedItems || (await listFailedItems({ runId: requestedRunId }));
  if (failedItems.length === 0) {
    console.log("没有找到需要补跑的抖店失败项");
    return [];
  }

  const runId = failedItems[0].runId;
  const targetShopNames = uniq(failedItems.map((item) => item.shopName));
  const targetDates = uniq(failedItems.map((item) => item.dataDate));
  const targetKinds = uniq(failedItems.map((item) => item.kind));
  const offsets = targetDates
    .map(offsetFromDataDate)
    .filter((n) => Number.isFinite(n));
  const daysToExport = offsets.length ? Math.max(...offsets) + 1 : 1;

  console.log(
    `抖店失败项补跑：runId=${runId}，店铺 ${targetShopNames.length} 个，日期 ${targetDates.join(", ")}，类型 ${targetKinds.join(", ")}`
  );

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized"]
  });
  activeBrowser = browser;

  const results = [];
  const processedNames = new Set();
  const remainingTargets = buildRemainingTargetsResolver(
    targetShopNames,
    processedNames
  );

  try {
    for (let i = 0; i < accounts.length; i += 1) {
      const account = accounts[i];
      const remaining = remainingTargets();
      if (remaining.length === 0) {
        console.log(
          `失败项目标店铺均已补跑 (${processedNames.size}/${targetShopNames.length})，提前结束`
        );
        break;
      }

      console.log(
        `\n========== 失败项补跑 ${i + 1}/${accounts.length}: ${account.email} | 剩余店铺 ${remaining.length}/${targetShopNames.length} ==========`
      );
      const result = await runOne(browser, account, {
        processedNames,
        daysToExport,
        exportBatchId: runId,
        accountEmail: account.email,
        selectedShopNames: targetShopNames,
        targetDates,
        targetKinds
      });
      results.push(result);
      collectProcessedNamesIntoSet(result, processedNames);
    }
  } finally {
    await browser.close();
    activeBrowser = null;
  }

  if (options.printSummary !== false) {
    printResultSummary(results);
  }
  return results;
}

async function runOne(browser, account, options = {}) {
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
    const result = await runShopLogin(context, account, options);
    return { account: account.email, ok: true, ...result };
  } catch (error) {
    console.error(
      `账号 [${account.email}] 执行失败: ${error.message || error}`
    );
    return {
      account: account.email,
      ok: false,
      error: error.message || String(error),
      processedNames: options.processedNames
    };
  } finally {
    await context.close();
  }
}

async function resetAccountDataDir(account) {
  const paths = getAccountPaths(account?.email || "");
  await fs.rm(paths.dataDir, { recursive: true, force: true });
  await fs.mkdir(paths.dataDir, { recursive: true });
  console.log(`[${account.email}] 已清空历史导出目录: ${paths.dataDir}`);
}

async function resetAccountsDataDirs(accounts) {
  for (const account of accounts) {
    if (!account?.email) continue;
    await resetAccountDataDir(account);
  }
}

async function runShopSyncFeishu(accounts, targetShopNames = []) {
  const preferredList =
    targetShopNames.length > 0
      ? targetShopNames
      : await loadPreferredShopNames();
  console.log("抖店同步飞书：开始登录拉取 → 校验 → 合并 → 同步飞书");
  await resetAccountsDataDirs(accounts);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized"]
  });
  activeBrowser = browser;

  let daysToExport = 1;
  try {
    daysToExport = await calcDaysToExport();
  } catch (e) {
    console.warn(`读取备份表失败（sync-feishu 使用默认值 1 天）: ${e.message}`);
  }

  const exportBatchId = createExportBatchId();
  console.log(`抖店本次导出批次: ${exportBatchId}`);

  const results = [];
  const processedNames = new Set();
  const totalTargets = preferredList.length;
  const remainingTargets = buildRemainingTargetsResolver(
    preferredList,
    processedNames
  );

  try {
    for (let i = 0; i < accounts.length; i += 1) {
      const account = accounts[i];
      const remaining = remainingTargets();
      if (totalTargets > 0 && remaining.length === 0) {
        console.log(
          `所有目标店铺均已处理 (${processedNames.size}/${totalTargets})，提前结束登录拉取`
        );
        break;
      }
      console.log(
        `\n========== 同步飞书前拉取 ${i + 1}/${accounts.length}: ${account.email} | 导出天数 ${daysToExport} ==========`
      );
      const result = await runOne(browser, account, {
        processedNames,
        daysToExport,
        exportBatchId,
        accountEmail: account.email,
        selectedShopNames: preferredList
      });
      results.push(result);
      collectProcessedNamesIntoSet(result, processedNames);
    }
  } finally {
    await browser.close();
    activeBrowser = null;
  }

  const { retryableItems } = await getRetryableFailedItems(exportBatchId);
  if (retryableItems.length > 0) {
    console.log("检测到可自动补跑的抖店失败项，开始自动补跑 1 次…");
    const retryResults = await runFailedShopExportRetry(accounts, {
      runId: exportBatchId,
      failedItems: retryableItems,
      printSummary: false
    });
    results.push(...retryResults);
  }

  const latestResults = getLatestResultsByAccount(results);
  const failed = latestResults.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(
      `抖店登录拉取失败账号：${failed.map((item) => `${item.account}: ${item.error}`).join("；")}`
    );
  }

  const processedAccountEmails = latestResults
    .map((r) => r.account)
    .filter(Boolean);
  const validation = await validateShopExportFiles({
    daysToExport,
    exportBatchId,
    preferredShopNames: preferredList,
    processedAccountEmails
  });
  console.log(
    `抖店导出文件校验：期望日期 ${validation.expectedDates.join(", ")}，检查店铺 ${validation.shopReports.length} 个`
  );
  if (!validation.ok) {
    for (const problem of validation.problems) {
      console.error(`抖店导出文件校验失败: ${problem}`);
    }
    throw new Error("抖店导出文件校验失败，已停止合并与飞书同步");
  }

  const mergeResult = await mergeAllShopExportsToData({
    daysToExport,
    exportBatchId,
    preferredShopNames: preferredList
  });
  const missingMergedDates = mergeResult.expectedDates.filter(
    (d) => !mergeResult.actualDates.includes(d)
  );
  if (missingMergedDates.length > 0) {
    throw new Error(
      `抖店汇总数据校验失败：缺失日期 ${missingMergedDates.join(", ")}；实际日期=${mergeResult.actualDates.join(", ") || "(空)"}`
    );
  }

  printResultSummary(latestResults);

  console.log("抖店数据拉取、文件校验、汇总校验均通过，开始同步飞书表格…");
  await startAndWaitInternalApiTask(
    "/api/feishu/sync",
    { profile: "shop" },
    { timeoutMs: 30 * 60 * 1000 }
  );
}

async function main() {
  const { command, accounts } = parseArgs(process.argv);

  if (command === "retry-failed") {
    await runFailedShopExportRetry(getDefaultAccounts());
    return;
  }

  const targetShopNames = await resolveTargetShopNames();

  if (command === "merge") {
    let daysToExport = 1;
    try {
      daysToExport = await calcDaysToExport();
    } catch (e) {
      console.warn(`读取备份表失败（merge 使用默认值 1 天）: ${e.message}`);
    }
    await mergeAllShopExportsToData({
      daysToExport,
      preferredShopNames: targetShopNames
    });
    return;
  }

  if (command === "feishu-sync") {
    console.log("同步抖店汇总数据到飞书多维表格…");
    await startAndWaitInternalApiTask(
      "/api/feishu/sync",
      { profile: "shop" },
      { timeoutMs: 30 * 60 * 1000 }
    );
    return;
  }

  if (command === "sync-feishu") {
    await runShopSyncFeishu(accounts, targetShopNames);
    return;
  }

  const preferredList = targetShopNames;
  console.log(
    `抖店登录：候选邮箱 ${accounts.length} 个: ${accounts
      .map((a) => a.email)
      .join(", ")}`
  );
  console.log(
    `目标店铺优先级名单 (${preferredList.length}): ${preferredList.join(", ") || "(空)"}`
  );
  await resetAccountsDataDirs(accounts);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized"]
  });
  activeBrowser = browser;

  // 读取飞书备份表最后日期，计算需要循环导出多少天
  const { daysToExport, targetDates } = await resolveExportDatePlan();

  const exportBatchId = createExportBatchId();
  console.log(`抖店本次导出批次: ${exportBatchId}`);

  const results = [];
  const processedNames = new Set();
  const totalTargets = preferredList.length;
  const remainingTargets = buildRemainingTargetsResolver(
    preferredList,
    processedNames
  );

  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    const remaining = remainingTargets();
    if (totalTargets > 0 && remaining.length === 0) {
      console.log(
        `\n所有目标店铺均已处理 (${processedNames.size}/${totalTargets})，提前结束，后续邮箱不再登录`
      );
      break;
    }
    console.log(
      `\n========== 邮箱 ${i + 1}/${accounts.length}: ${account.email} | 剩余待处理店铺 ${remaining.length}${
        totalTargets > 0 ? `/${totalTargets}` : ""
      } ==========`
    );

    const result = await runOne(browser, account, {
      processedNames,
      daysToExport,
      exportBatchId,
      accountEmail: account.email,
      selectedShopNames: preferredList,
      targetDates
    });
    results.push(result);

    collectProcessedNamesIntoSet(result, processedNames);
  }

  await browser.close();
  activeBrowser = null;

  const { retryableItems } = await getRetryableFailedItems(exportBatchId);
  if (retryableItems.length > 0) {
    console.log("检测到可自动补跑的抖店失败项，开始自动补跑 1 次…");
    const retryResults = await runFailedShopExportRetry(accounts, {
      runId: exportBatchId,
      failedItems: retryableItems,
      printSummary: false
    });
    results.push(...retryResults);
    for (const result of retryResults) {
      collectProcessedNamesIntoSet(result, processedNames);
    }
  }

  await mergeAllShopExportsToData({
    daysToExport,
    exportBatchId,
    preferredShopNames: preferredList
  }).catch((err) => {
    console.error("抖店数据汇总失败:", err.message || err);
  });

  const stillRemaining = remainingTargets();
  if (totalTargets > 0) {
    console.log(
      `\n店铺处理进度: 已处理 ${processedNames.size}/${totalTargets}${
        stillRemaining.length
          ? `，剩余未命中: ${stillRemaining.join(", ")}`
          : "（全部完成）"
      }`
    );
  }

  printResultSummary(getLatestResultsByAccount(results));
}

main()
  .catch((error) => {
    console.error("脚本执行失败:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeExportItemStore().catch(() => {});
  });
