#!/usr/bin/env node

require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

const {
  ACCOUNTS_DIR,
  BROWSER_VIEWPORT,
  HEADLESS,
  SHOP_HOME_URL
} = require("../lib/env");
const { detectStage, retryableGoto, waitForStage, STAGES } = require("../lib/page-utils");
const {
  isShopPickerVisible,
  selectShopIfPicker,
  waitForShopItems
} = require("../lib/shop-picker");
const { gotoVideoSelf } = require("../lib/video-detail");
const { gotoGraphic } = require("../lib/graphic-detail");

const RESULT_ROOT = path.resolve(
  process.cwd(),
  process.env.SHOP_STABILITY_RESULT_DIR || "storage/stability-results/douyin-shop"
);

const NETWORK_PRESETS = {
  "degraded-4g": {
    offline: false,
    latency: 180,
    downloadThroughput: (1500 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8
  },
  "slow-3g": {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8
  },
  "very-slow": {
    offline: false,
    latency: 900,
    downloadThroughput: (160 * 1024) / 8,
    uploadThroughput: (120 * 1024) / 8
  }
};

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

function safeName(name) {
  return String(name || "unknown").replace(/[\\/:*?"<>|]+/g, "_");
}

async function findStorageState() {
  const explicitEmail = String(process.env.SHOP_STABILITY_EMAIL || "").trim();
  if (explicitEmail) {
    const explicit = path.join(ACCOUNTS_DIR, safeName(explicitEmail), "storageState.json");
    await fs.access(explicit);
    return { email: explicitEmail, storageStatePath: explicit };
  }

  const entries = await fs.readdir(ACCOUNTS_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const storageStatePath = path.join(ACCOUNTS_DIR, entry.name, "storageState.json");
    try {
      await fs.access(storageStatePath);
      return { email: entry.name, storageStatePath };
    } catch {
      // try next account
    }
  }
  throw new Error(`未找到可用于测试的抖店 storageState: ${ACCOUNTS_DIR}`);
}

async function installNetworkProfile(context, page, profileName) {
  const profile = NETWORK_PRESETS[profileName] || NETWORK_PRESETS["slow-3g"];
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", profile);
  return profile;
}

async function timedStep(report, name, fn) {
  const startedAt = Date.now();
  const step = { name, status: "running", startedAt: new Date(startedAt).toISOString() };
  report.steps.push(step);
  try {
    const data = await fn();
    step.status = "success";
    step.durationMs = Date.now() - startedAt;
    if (data && typeof data === "object") {
      const { name: returnedName, ...rest } = data;
      Object.assign(step, rest);
      if (returnedName) step.resultName = returnedName;
    }
    console.log(`[stability] ${name} ✓ ${step.durationMs}ms`);
    return data;
  } catch (error) {
    step.status = "failed";
    step.durationMs = Date.now() - startedAt;
    step.error = error?.message || String(error);
    console.error(`[stability] ${name} ✗ ${step.durationMs}ms ${step.error}`);
    throw error;
  }
}

async function selectShopForSmoke(page, report) {
  if (!(await isShopPickerVisible(page))) return { picked: false };

  const explicit = String(process.env.SHOP_STABILITY_SHOP || "").trim();
  if (explicit) {
    return selectShopIfPicker(page, {
      tag: "slow-network-smoke",
      preferredList: [explicit],
      timeoutMs: 15000
    });
  }

  const items = await waitForShopItems(page, 60000);
  const first = items.find((item) => item.name && item.locator);
  report.availableShopNames = items.map((item) => item.name).filter(Boolean);
  if (!first) throw new Error("已在选店页，但没有读取到可点击店铺项");

  console.log(`[stability] 选店页无指定店铺，使用第一个店铺: ${first.name}`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    first.locator.click({ timeout: 8000 })
  ]);
  await page.waitForTimeout(2000);
  return { picked: true, name: first.name };
}

async function waitForPickerIfLoginCommon(page) {
  const url = page.url() || "";
  if (!/\/login\/common/.test(url)) return false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await isShopPickerVisible(page)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function main() {
  const profileName = process.env.SHOP_STABILITY_NETWORK || "slow-3g";
  const account = await findStorageState();
  const runDir = path.join(RESULT_ROOT, `${nowStamp()}-${safeName(account.email)}-${profileName}`);
  await fs.mkdir(runDir, { recursive: true });

  const report = {
    accountEmail: account.email,
    profileName,
    resultDir: runDir,
    startedAt: new Date().toISOString(),
    steps: []
  };

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--start-maximized"]
  });

  let page;
  try {
    const context = await browser.newContext({
      viewport: BROWSER_VIEWPORT,
      storageState: account.storageStatePath,
      acceptDownloads: true
    });
    page = await context.newPage();
    const profile = await installNetworkProfile(context, page, profileName);
    report.networkProfile = profile;

    await timedStep(report, "goto-home", async () => {
      await retryableGoto(page, SHOP_HOME_URL, {
        timeout: 45000,
        maxRetries: 2,
        baseBackoff: 2500,
        expectedUrlRe: /jinritemai\.com/
      });
      return { url: page.url() };
    });

    await timedStep(report, "detect-auth-stage", async () => {
      const stage = await waitForStage(
        page,
        [
          STAGES.LOGIN_FORM,
          STAGES.SHOP_PICKER,
          STAGES.COMPASS_VIDEO,
          STAGES.COMPASS_GRAPHIC,
          STAGES.COMPASS_OTHER,
          STAGES.FXG_WORKSPACE,
          STAGES.CAPTCHA
        ],
        { timeoutMs: 45000, intervalMs: 500 }
      );
      if (stage.stage === STAGES.UNKNOWN && (await waitForPickerIfLoginCommon(page))) {
        return { stage: STAGES.SHOP_PICKER, url: page.url(), delayedPicker: true };
      }
      const accepted = [
        STAGES.SHOP_PICKER,
        STAGES.COMPASS_VIDEO,
        STAGES.COMPASS_GRAPHIC,
        STAGES.COMPASS_OTHER,
        STAGES.FXG_WORKSPACE,
        STAGES.LOGIN_FORM,
        STAGES.CAPTCHA
      ];
      if (!accepted.includes(stage.stage)) {
        throw new Error(`阶段识别超时: stage=${stage.stage} url=${stage.url}`);
      }
      return { stage: stage.stage, url: stage.url };
    });

    const current = await detectStage(page);
    if (current.stage === STAGES.SHOP_PICKER || (await isShopPickerVisible(page))) {
      await timedStep(report, "select-shop", async () => selectShopForSmoke(page, report));
    }

    const afterPick = await detectStage(page);
    if (afterPick.stage === STAGES.LOGIN_FORM || afterPick.stage === STAGES.CAPTCHA) {
      throw new Error(`登录态不可用，当前阶段=${afterPick.stage} url=${afterPick.url}`);
    }

    await timedStep(report, "goto-video-self-ready", async () => {
      await gotoVideoSelf(page, "slow-network-smoke");
      return { url: page.url() };
    });

    await timedStep(report, "goto-graphic-ready", async () => {
      await gotoGraphic(page, "slow-network-smoke");
      return { url: page.url() };
    });

    report.status = "success";
  } catch (error) {
    report.status = "failed";
    report.error = error?.message || String(error);
    if (page) {
      const shot = path.join(runDir, "failure.png");
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      report.failureScreenshot = shot;
    }
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(runDir, "report.json"), JSON.stringify(report, null, 2), "utf-8");
    await browser.close().catch(() => {});
    console.log(`[stability] report: ${path.join(runDir, "report.json")}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
