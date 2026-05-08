require("dotenv").config();

const fs = require("fs/promises");
const { execSync } = require("child_process");
const { chromium } = require("playwright");

const {
  BROWSER_VIEWPORT,
  HEADLESS,
  getDefaultAccounts
} = require("./lib/env");
const { runShopLogin, getAccountPaths } = require("./lib/login");
const { loadPreferredShopNames } = require("./lib/shop-picker");
const {
  mergeAllShopExportsToData,
  validateShopExportFiles
} = require("./lib/merge-shop-exports");
const { calcDaysToExport } = require("./lib/backup-dates");

function parseArgs(argv) {
  // 支持 "login"（默认）或 "login <email> <password>"
  const args = argv.slice(2);
  const command =
    args[0] && !args[0].includes("@")
      ? String(args[0]).toLowerCase()
      : "login";
  const positional = args[0] && !args[0].includes("@") ? args.slice(1) : args;

  if (command === "merge" || command === "feishu-sync") {
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

async function resolveTargetShopNames() {
  const selected = parseSelectedShopNamesFromEnv();
  if (selected.length > 0) return selected;
  return await loadPreferredShopNames();
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

async function runShopSyncFeishu(accounts, targetShopNames = []) {
  const preferredList = targetShopNames.length > 0
    ? targetShopNames
    : await loadPreferredShopNames();
  console.log("抖店同步飞书：开始登录拉取 → 校验 → 合并 → 同步飞书");

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized"]
  });

  let daysToExport = 1;
  try {
    daysToExport = await calcDaysToExport();
  } catch (e) {
    console.warn(`读取备份表失败（sync-feishu 使用默认值 1 天）: ${e.message}`);
  }

  const results = [];
  const processedNames = new Set();
  const totalTargets = preferredList.length;

  function remainingTargets() {
    if (totalTargets === 0) return [];
    return preferredList.filter((name) => {
      for (const done of processedNames) {
        if (!done) continue;
        if (done === name) return false;
        if (name.includes(done) || done.includes(name)) return false;
      }
      return true;
    });
  }

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
        selectedShopNames: preferredList
      });
      results.push(result);
      if (result.processedNames instanceof Set) {
        for (const n of result.processedNames) processedNames.add(n);
      }
      if (Array.isArray(result.downloads)) {
        for (const d of result.downloads) {
          if (d && d.shopName) processedNames.add(d.shopName);
        }
      }
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(
      `抖店登录拉取失败账号：${failed.map((item) => `${item.account}: ${item.error}`).join("；")}`
    );
  }

  const validation = await validateShopExportFiles({
    daysToExport,
    preferredShopNames: preferredList
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

  console.log("抖店数据拉取、文件校验、汇总校验均通过，开始同步飞书表格…");
  execSync("node scripts/run.js feishu:sync-data-xlsx-shop", {
    stdio: "inherit",
    cwd: process.cwd()
  });
}

async function main() {
  const { command, accounts } = parseArgs(process.argv);
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
    execSync("node scripts/run.js feishu:sync-data-xlsx-shop", {
      stdio: "inherit",
      cwd: process.cwd()
    });
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

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized"]
  });

  // 读取飞书备份表最后日期，计算需要循环导出多少天
  let daysToExport = 1;
  try {
    daysToExport = await calcDaysToExport();
  } catch (e) {
    console.warn(`读取备份表失败（不影响登录，使用默认值 1 天）: ${e.message}`);
  }

  const results = [];
  const processedNames = new Set();
  const totalTargets = preferredList.length;

  function remainingTargets() {
    if (totalTargets === 0) return [];
    return preferredList.filter((name) => {
      for (const done of processedNames) {
        if (!done) continue;
        if (done === name) return false;
        if (name.includes(done) || done.includes(name)) return false;
      }
      return true;
    });
  }

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
      selectedShopNames: preferredList
    });
    results.push(result);

    if (result.processedNames instanceof Set) {
      for (const n of result.processedNames) processedNames.add(n);
    }
    if (Array.isArray(result.downloads)) {
      for (const d of result.downloads) {
        if (d && d.shopName) processedNames.add(d.shopName);
      }
    }
  }

  await browser.close();

  await mergeAllShopExportsToData({
    daysToExport,
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

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n完成: 成功 ${okCount} / ${results.length}`);

  console.log(`\n最终结果明细:`);
  for (const item of results) {
    if (!item.ok) {
      console.log(`  [${item.account}] 登录失败: ${item.error}`);
      continue;
    }
    const downloads = Array.isArray(item.downloads) ? item.downloads : [];
    if (downloads.length === 0) {
      console.log(`  [${item.account}] 无数据导出`);
      continue;
    }
    for (const d of downloads) {
      const name = d.shopName || "未知店铺";
      const videoIcon = d.videoDays === d.daysToExport ? '✓' : '✗';
      const graphicIcon = d.graphicDays === d.daysToExport ? '✓' : '✗';
      const status = d.videoPath && d.graphicPath ? '全部完成' :
                     d.videoPath ? '仅视频完成' :
                     d.graphicPath ? '仅图文完成' : '全部失败';
      console.log(
        `  ✓ [${item.account}] ${name}` +
        ` | 视频 ${d.videoDays || 0}/${d.daysToExport || 1}天 ${videoIcon}` +
        ` | 图文 ${d.graphicDays || 0}/${d.daysToExport || 1}天 ${graphicIcon}` +
        ` | ${status}`
      );
      if (d.videoError) console.log(`      视频错误: ${d.videoError}`);
      if (d.graphicError) console.log(`      图文错误: ${d.graphicError}`);
      if (d.videoPath) console.log(`      视频文件: ${d.videoPath}`);
      if (d.graphicPath) console.log(`      图文文件: ${d.graphicPath}`);
      const vdm = Array.isArray(d.videoDateMismatches) ? d.videoDateMismatches : [];
      const gdm = Array.isArray(d.graphicDateMismatches) ? d.graphicDateMismatches : [];
      if (vdm.length) console.log(`      ⚠ 视频日期不符（日历选中≠预期）: ${vdm.join(', ')}`);
      if (gdm.length) console.log(`      ⚠ 图文日期不符（日历选中≠预期）: ${gdm.join(', ')}`);
    }
  }

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
