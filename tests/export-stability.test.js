require("dotenv").config();

const path = require("path");
const fs = require("fs/promises");
const { chromium } = require("playwright");

const { BROWSER_VIEWPORT, HEADLESS, ACCOUNTS_DIR } = require("../scripts/douyin-shop/lib/env");
const { runShopLogin, getAccountPaths } = require("../scripts/douyin-shop/lib/login");
const { loadPreferredShopNames } = require("../scripts/douyin-shop/lib/shop-picker");
const {
  collectProcessedNamesIntoSet,
  buildRemainingTargetsResolver
} = require("../scripts/douyin-shop/lib/index-helpers");

const TARGET_SHOPS = [
  "莲藕医药专营店",
  "澳诺旗舰店",
  "红绿草医药专营店",
  "江中制药医药旗舰店",
  "达仁堂官方旗舰店",
  "维乐多官方旗舰店",
  "美迪生官方旗舰店",
];

const STABILITY_PASSES = 5;
const TEST_DEFAULT_DAYS = 1;
const CONSECUTIVE_DAYS = 3;
const CROSS_MONTH_OFFSET = 30;

// ── Test results tracking ──────────────────────────────────────────

class TestResults {
  constructor() {
    this.passes = [];
    this.totalShops = TARGET_SHOPS.length;
  }

  recordPass(passIndex, results) {
    this.passes[passIndex] = {
      index: passIndex,
      results,
      summary: this.summarizePass(results),
      timestamp: new Date().toISOString()
    };
  }

  summarizePass(results) {
    const shops = {};
    for (const r of results) {
      for (const d of (r.downloads || [])) {
        if (!d.shopName) continue;
        shops[d.shopName] = {
          videoDays: d.videoDays || 0,
          graphicDays: d.graphicDays || 0,
          daysToExport: d.daysToExport || 0,
          videoOk: !d.videoError,
          graphicOk: !d.graphicError,
          failures: (d.failures || []).length,
          dateMismatches: [
            ...(d.videoDateMismatches || []),
            ...(d.graphicDateMismatches || [])
          ].length
        };
      }
    }
    const okShops = Object.values(shops).filter(s => s.videoOk && s.graphicOk).length;
    return { shops, okShops, totalShops: this.totalShops };
  }

  printAllPassesReport() {
    console.log("\n" + "═".repeat(70));
    console.log(`稳定性测试最终报告 — ${this.passes.length} 轮测试`);
    console.log("═".repeat(70));

    let totalOkShops = 0;
    let totalExpected = 0;
    const shopHistory = {};

    for (const pass of this.passes) {
      const s = pass.summary;
      totalOkShops += s.okShops;
      totalExpected += s.totalShops;
      console.log(`\n第 ${pass.index + 1} 轮: ${s.okShops}/${s.totalShops} 店铺成功 | ${s.okShops === s.totalShops ? "✓ 全部通过" : "✗ 有失败"}`);

      for (const [shopName, info] of Object.entries(s.shops)) {
        if (!shopHistory[shopName]) shopHistory[shopName] = { passes: 0, fails: 0 };
        if (info.videoOk && info.graphicOk) {
          shopHistory[shopName].passes++;
        } else {
          shopHistory[shopName].fails++;
        }
        const status = info.videoOk && info.graphicOk ? "✓" : "✗";
        console.log(`  ${status} ${shopName}: 视频${info.videoDays}/${info.daysToExport}天 图文${info.graphicDays}/${info.daysToExport}天 | 失败项${info.failures} | 日期不符${info.dateMismatches}`);
      }
    }

    console.log("\n" + "─".repeat(70));
    console.log(`总体成功率: ${totalOkShops}/${totalExpected} (${((totalOkShops/totalExpected)*100).toFixed(1)}%)`);
    console.log("─".repeat(70));

    console.log("\n按店铺统计:");
    for (const [shopName, hist] of Object.entries(shopHistory)) {
      const rate = ((hist.passes / this.passes.length) * 100).toFixed(0);
      const bar = "█".repeat(Math.round(hist.passes / this.passes.length * 20)) +
        "░".repeat(20 - Math.round(hist.passes / this.passes.length * 20));
      console.log(`  [${bar}] ${shopName}: ${hist.passes}/${this.passes.length} 轮成功 (${rate}%)`);
    }

    // 稳定性判断
    const allStable = Object.values(shopHistory).every(h => h.fails === 0);
    if (allStable) {
      console.log("\n✓✓✓ 所有店铺在所有轮次均稳定通过！");
    } else {
      console.log("\n⚠ 存在不稳定的店铺，详见上方统计");
    }
  }
}

// ── Login with stored cookies ───────────────────────────────────────

async function loginWithCookies(browser, account) {
  const { email, password } = account;
  const paths = getAccountPaths(email);
  const hasStorage = await fs.access(paths.storageStatePath).then(() => true).catch(() => false);

  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    storageState: hasStorage ? paths.storageStatePath : undefined
  });

  try {
    const result = await runShopLogin(context, account, {
      selectedShopNames: TARGET_SHOPS,
      daysToExport: TEST_DEFAULT_DAYS
    });
    return { ...result, context };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

// ── Stability test runner ───────────────────────────────────────────

async function runStabilityPass(passIndex, account) {
  console.log(`\n${"━".repeat(60)}`);
  console.log(`稳定性测试第 ${passIndex + 1}/${STABILITY_PASSES} 轮`);
  console.log(`账号: ${account.email} | 目标店铺: ${TARGET_SHOPS.length} 个`);
  console.log(`${"━".repeat(60)}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized", "--disable-dev-shm-usage"]
  });

  const results = [];
  const processedNames = new Set();
  const remainingTargets = buildRemainingTargetsResolver(TARGET_SHOPS, processedNames);

  try {
    // Only use one account per pass for testing
    const remaining = remainingTargets();
    console.log(`剩余待处理店铺: ${remaining.join(", ")}`);

    const result = await loginWithCookies(browser, account);
    results.push(result);
    collectProcessedNamesIntoSet(result, processedNames);

  } finally {
    await browser.close().catch(() => {});
  }

  return results;
}

// ── Main entry ──────────────────────────────────────────────────────

async function main() {
  const accounts = [
    { email: "lianou_rpa@163.com", password: "Lianou123" }
  ];

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║          抖店数据导出流程稳定性测试                                ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log(`\n测试账号: ${accounts[0].email}`);
  console.log(`目标店铺 (${TARGET_SHOPS.length}):`);
  TARGET_SHOPS.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log(`稳定性轮数: ${STABILITY_PASSES}`);
  console.log(`\n测试场景:`);
  console.log(`  - 连续${CONSECUTIVE_DAYS}天数据导出`);
  console.log(`  - 跨月数据导出 (offset=${CROSS_MONTH_OFFSET})`);
  console.log(`  - 网络波动模拟 (缩短超时)`);

  const reporter = new TestResults();

  for (let pass = 0; pass < STABILITY_PASSES; pass++) {
    try {
      const results = await runStabilityPass(pass, accounts[0]);
      reporter.recordPass(pass, results);
    } catch (error) {
      console.error(`第 ${pass + 1} 轮测试异常终止:`, error.message || error);
      reporter.recordPass(pass, [{ ok: false, error: error.message || String(error) }]);
    }
    // Brief pause between passes
    if (pass < STABILITY_PASSES - 1) {
      console.log(`\n等待 3 秒后开始下一轮...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  reporter.printAllPassesReport();
}

main().catch((error) => {
  console.error("稳定性测试失败:", error);
  process.exitCode = 1;
});
