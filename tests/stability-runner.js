require("dotenv").config();

const path = require("path");
const fs = require("fs/promises");
const { chromium } = require("playwright");
const { BROWSER_VIEWPORT } = require("../scripts/douyin-shop/lib/env");
const { getAccountPaths, runShopLogin } = require("../scripts/douyin-shop/lib/login");

const TARGET_SHOPS = [
  "莲藕医药专营店", "澳诺旗舰店", "红绿草医药专营店",
  "江中制药医药旗舰店", "达仁堂官方旗舰店", "维乐多官方旗舰店",
  "美迪生官方旗舰店",
];

const PASSES = 5;
const DAYS = 1;

async function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function runOnePass(passNum, account, resultsDir) {
  const passDir = path.join(resultsDir, `pass-${passNum + 1}`);
  await fs.mkdir(passDir, { recursive: true });

  const logFile = path.join(passDir, "log.txt");
  const logStream = await fs.open(logFile, "w");
  const writeLog = (s) => logStream.write(s + "\n");

  writeLog(`=== 稳定性测试 第${passNum + 1}轮 ===`);
  writeLog(`时间: ${new Date().toISOString()}`);
  writeLog(`目标店铺: ${TARGET_SHOPS.join(", ")}`);
  writeLog(`账号: ${account.email}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--start-maximized", "--disable-dev-shm-usage"]
  });

  const paths = getAccountPaths(account.email);
  const hasStorage = await fs.access(paths.storageStatePath).then(() => true).catch(() => false);

  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    storageState: hasStorage ? paths.storageStatePath : undefined
  });

  const passResult = {
    pass: passNum + 1,
    startTime: new Date().toISOString(),
    shops: {},
    errors: []
  };

  try {
    writeLog(`开始登录 (cookie复用: ${hasStorage ? "是" : "否"})`);

    const result = await runShopLogin(context, account, {
      selectedShopNames: TARGET_SHOPS,
      daysToExport: DAYS
    });

    writeLog(`登录结果: ${result.ok ? "成功" : "失败"}`);
    writeLog(`处理店铺数: ${(result.downloads || []).length}`);

    for (const d of (result.downloads || [])) {
      const name = d.shopName || "未知";
      const videoOk = !d.videoError;
      const graphicOk = !d.graphicError;
      writeLog(`  ${name}: 视频=${d.videoDays}/${d.daysToExport}${videoOk ? '✓' : '✗'} 图文=${d.graphicDays}/${d.daysToExport}${graphicOk ? '✓' : '✗'}`);
      passResult.shops[name] = {
        videoOk, graphicOk,
        videoDays: d.videoDays || 0,
        graphicDays: d.graphicDays || 0,
        daysToExport: d.daysToExport || 0,
        videoError: d.videoError || null,
        graphicError: d.graphicError || null,
        failures: d.failures ? d.failures.map(f => `${f.step}: ${f.message}`) : []
      };
    }
  } catch (error) {
    writeLog(`ERROR: ${error.message || error}`);
    passResult.errors.push(error.message || String(error));
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    writeLog(`结束时间: ${new Date().toISOString()}`);
    await logStream.close();
  }

  passResult.endTime = new Date().toISOString();
  return passResult;
}

async function main() {
  const resultsDir = path.join(__dirname, "..", "storage", "stability-results");
  await fs.mkdir(resultsDir, { recursive: true });

  const account = { email: "lianou_rpa@163.com", password: "Lianou123" };

  log("╔═════════════════════════════════════╗");
  log("║  抖店数据导出稳定性测试 v2         ║");
  log("╚═════════════════════════════════════╝");
  log(`测试店铺: ${TARGET_SHOPS.length}个`);
  log(`测试轮数: ${PASSES}轮`);
  log(`每店铺导出天数: ${DAYS}`);
  log(`结果目录: ${resultsDir}`);

  const allResults = [];

  for (let p = 0; p < PASSES; p++) {
    log(`\n========== 第 ${p + 1}/${PASSES} 轮开始 ==========`);
    const result = await runOnePass(p, account, resultsDir);
    allResults.push(result);

    // Print quick summary
    const okShops = Object.values(result.shops).filter(s => s.videoOk && s.graphicOk).length;
    log(`第 ${p + 1} 轮完成: ${okShops}/${TARGET_SHOPS.length} 店铺成功`);

    if (p < PASSES - 1) {
      log(`等待 5 秒...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Final report
  const reportFile = path.join(resultsDir, "report.json");
  await fs.writeFile(reportFile, JSON.stringify(allResults, null, 2));

  console.log("\n" + "═".repeat(60));
  console.log("最终报告");
  console.log("═".repeat(60));

  const shopStats = {};
  for (const shop of TARGET_SHOPS) {
    shopStats[shop] = { passes: 0, fails: 0, errors: [] };
  }

  for (const pass of allResults) {
    for (const shop of TARGET_SHOPS) {
      const s = pass.shops[shop];
      if (s && s.videoOk && s.graphicOk) {
        shopStats[shop].passes++;
      } else {
        shopStats[shop].fails++;
        if (s) shopStats[shop].errors.push(s.failures);
      }
    }
  }

  for (const [shop, stats] of Object.entries(shopStats)) {
    const rate = stats.passes / PASSES * 100;
    const status = stats.passes === PASSES ? "✓ 稳定" : `✗ ${stats.fails}/${PASSES}轮失败`;
    console.log(`  ${status.padEnd(12)} ${shop}: ${stats.passes}/${PASSES} (${rate.toFixed(0)}%)`);
  }

  const totalStable = Object.values(shopStats).filter(s => s.passes === PASSES).length;
  console.log(`\n稳定率: ${totalStable}/${TARGET_SHOPS.length} (${(totalStable/TARGET_SHOPS.length*100).toFixed(0)}%)`);
  console.log(`详细报告: ${reportFile}`);
}

main().catch(e => {
  console.error("FATAL:", e.message || e);
  process.exit(1);
});
