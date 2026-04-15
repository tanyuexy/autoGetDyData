const fs = require("fs/promises");
const path = require("path");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
require("dotenv").config();
const { chromium } = require("playwright");
const nodemailer = require("nodemailer");

const TARGET_URL = "https://creator.douyin.com/creator-micro/data-center/content";
const ACCOUNTS_DIR = path.resolve(process.cwd(), "accounts");
const DEFAULT_ALERT_TO = "2895845213@qq.com";
const BROWSER_VIEWPORT = { width: 1600, height: 1000 };

function numberFromEnv(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const val = Number(raw);
  if (!Number.isFinite(val) || val <= 0) return defaultValue;
  return val;
}

const LOGIN_WAIT_TIMEOUT_MS = numberFromEnv("LOGIN_WAIT_TIMEOUT_MS", 15 * 60 * 1000);
const LOGIN_REMIND_INTERVAL_MS = numberFromEnv("LOGIN_REMIND_INTERVAL_MS", 60 * 1000);

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeAccountName(name) {
  return name.trim().replace(/[\\/:*?"<>|]/g, "_");
}

function getAccountPaths(accountName) {
  const accountDir = path.join(ACCOUNTS_DIR, accountName);
  return {
    accountDir,
    storageStatePath: path.join(accountDir, "storageState.json"),
    cookiesPath: path.join(accountDir, "cookies.json"),
    dataDir: path.join(accountDir, "data"),
    alertDir: path.join(accountDir, "alerts"),
  };
}

async function promptInput(question) {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

async function isLoggedInAtTarget(page) {
  const inTargetPage = page.url().includes("/creator-micro/data-center/content");
  const hasPostListTab = await page.locator("text=投稿列表").first().isVisible({ timeout: 1500 }).catch(() => false);
  return inTargetPage && hasPostListTab;
}

function getMailConfig() {
  const host = process.env.SMTP_HOST || "smtp.qq.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false";
  const user = process.env.ALERT_EMAIL_USER || process.env.SMTP_USER || "";
  const pass = process.env.ALERT_EMAIL_PASS || process.env.SMTP_PASS || "";
  const from = process.env.ALERT_EMAIL_FROM || user;
  const to = process.env.ALERT_EMAIL_TO || DEFAULT_ALERT_TO;
  const enabled = String(process.env.ALERT_EMAIL_ENABLED || "true").toLowerCase() !== "false";
  return { enabled, host, port, secure, user, pass, from, to };
}

async function sendAlertEmail({ accountName, screenshotPath, reason }) {
  const cfg = getMailConfig();
  if (!cfg.enabled) {
    console.log("邮件告警已关闭，跳过发送。");
    return;
  }

  if (!cfg.user || !cfg.pass || !cfg.from || !cfg.to) {
    console.log("邮件配置不完整，跳过发送。请设置 ALERT_EMAIL_USER / ALERT_EMAIL_PASS / ALERT_EMAIL_FROM / ALERT_EMAIL_TO。");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  const subject = `[抖音导出告警] 账号${accountName}需要重新扫码登录`;
  const html = `
    <div>
      <p>账号 <b>${accountName}</b> 需要重新扫码登录。</p>
      <p>触发原因: ${reason}</p>
      <p>目标页面: ${TARGET_URL}</p>
      <p>截图时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}</p>
    </div>
  `;

  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to,
    subject,
    html,
    attachments: [
      {
        filename: path.basename(screenshotPath),
        path: screenshotPath,
      },
    ],
  });
  console.log(`账号 [${accountName}] 已发送扫码提醒邮件到: ${cfg.to}`);
}

async function sendSmsVerifyEmail({ accountName, screenshotPath, maskedPhone, smsContent, smsTarget }) {
  const cfg = getMailConfig();
  if (!cfg.enabled) {
    console.log("邮件告警已关闭，跳过发送。");
    return;
  }
  if (!cfg.user || !cfg.pass || !cfg.from || !cfg.to) {
    console.log("邮件配置不完整，跳过发送短信验证提醒。");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  const subject = `[抖音短信验证] 账号${accountName}需要发送验证短信`;
  const html = `
    <div>
      <p>账号 <b>${accountName}</b> 登录后触发身份验证，请发送短信。</p>
      <p>手机号(掩码): <b>${maskedPhone || "未识别"}</b></p>
      <p>短信内容: <b>${smsContent || "未识别"}</b></p>
      <p>发送至: <b>${smsTarget || "未识别"}</b></p>
      <p>目标页面: ${TARGET_URL}</p>
      <p>时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}</p>
    </div>
  `;

  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to,
    subject,
    html,
    attachments: [
      {
        filename: path.basename(screenshotPath),
        path: screenshotPath,
      },
    ],
  });
  console.log(`账号 [${accountName}] 已发送短信验证提醒邮件到: ${cfg.to}`);
}

async function sendFaceVerifyEmail({ accountName, screenshotPath, reason }) {
  const cfg = getMailConfig();
  if (!cfg.enabled) {
    console.log("邮件告警已关闭，跳过发送。");
    return;
  }
  if (!cfg.user || !cfg.pass || !cfg.from || !cfg.to) {
    console.log("邮件配置不完整，跳过发送刷脸验证提醒。");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  const subject = `[抖音刷脸验证] 账号${accountName}需要手机刷脸扫码`;
  const html = `
    <div>
      <p>账号 <b>${accountName}</b> 已进入 <b>手机刷脸验证</b> 阶段。</p>
      <p>请使用抖音 App 扫描刷脸二维码并完成人脸验证。</p>
      <p>说明: ${reason || "需要刷脸验证"}</p>
      <p>目标页面: ${TARGET_URL}</p>
      <p>时间: ${new Date().toLocaleString("zh-CN", { hour12: false })}</p>
    </div>
  `;

  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to,
    subject,
    html,
    attachments: [
      {
        filename: path.basename(screenshotPath),
        path: screenshotPath,
      },
    ],
  });
  console.log(`账号 [${accountName}] 已发送刷脸验证提醒邮件到: ${cfg.to}`);
}

async function captureLoginQrScreenshot(page, paths, accountName) {
  await ensureDir(paths.alertDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(paths.alertDir, `${timestamp}-login-qr.png`);
  await page.waitForTimeout(1500);

  const tryCaptureLocator = async (locator) => {
    const visible = await locator.isVisible({ timeout: 1200 }).catch(() => false);
    if (!visible) return false;

    const box = await locator.boundingBox().catch(() => null);
    if (!box) return false;
    if (box.width < 120 || box.height < 120) return false;
    const ratioDiff = Math.abs(box.width - box.height) / Math.max(box.width, box.height);
    if (ratioDiff > 0.4) return false;

    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.screenshot({ path: screenshotPath }).catch(() => {});
    return fileExists(screenshotPath);
  };

  const qrSelectors = [
    "img[src*='qrcode']",
    "img[alt*='二维码']",
    "[class*='qrcode'] img",
    "[class*='qrcode'] canvas",
    "canvas",
  ];

  for (const selector of qrSelectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 6);
    for (let i = 0; i < count; i += 1) {
      if (await tryCaptureLocator(locator.nth(i))) {
        console.log(`账号 [${accountName}] 已保存二维码截图: ${screenshotPath}`);
        return screenshotPath;
      }
    }
  }

  const viewport = page.viewportSize() || BROWSER_VIEWPORT;
  const rightClip = {
    x: Math.max(0, Math.floor(viewport.width * 0.52)),
    y: 0,
    width: Math.floor(viewport.width * 0.48),
    height: viewport.height,
  };
  await page.screenshot({ path: screenshotPath, clip: rightClip }).catch(() => {});
  if (await fileExists(screenshotPath)) {
    console.log(`账号 [${accountName}] 已保存右侧登录区截图: ${screenshotPath}`);
    return screenshotPath;
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(`账号 [${accountName}] 已保存登录截图: ${screenshotPath}`);
  return screenshotPath;
}

const smsNotifySentByAccount = new Set();
const faceNotifySentByAccount = new Set();
const loginStageHintByAccount = new Map();

async function captureVerifyDialogScreenshot(page, paths, accountName, suffix) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(paths.alertDir, `${timestamp}-${suffix}.png`);
  const dialog = page.locator("[role='dialog']").last();
  const dialogVisible = await dialog.isVisible({ timeout: 800 }).catch(() => false);
  if (dialogVisible) {
    await dialog.screenshot({ path: screenshotPath }).catch(() => {});
  }
  if (!(await fileExists(screenshotPath))) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  }
  console.log(`账号 [${accountName}] 已保存验证截图: ${screenshotPath}`);
  return screenshotPath;
}

async function captureFaceQrScreenshot(page, paths, accountName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(paths.alertDir, `${timestamp}-face-verify.png`);

  const qrCandidates = [
    page.locator("div:has-text('手机刷脸验证') canvas").first(),
    page.locator("div:has-text('手机刷脸验证') img[src*='qrcode']").first(),
    page.locator("img[src*='qrcode']").first(),
    page.locator("[class*='qrcode'] canvas").first(),
    page.locator("[class*='qrcode'] img").first(),
    page.locator("canvas").first(),
  ];

  for (const locator of qrCandidates) {
    const visible = await locator.isVisible({ timeout: 700 }).catch(() => false);
    if (!visible) continue;

    const box = await locator.boundingBox().catch(() => null);
    if (!box) continue;
    if (box.width < 120 || box.height < 120) continue;

    const viewport = page.viewportSize() || BROWSER_VIEWPORT;
    const pad = 120;
    const clip = {
      x: Math.max(0, Math.floor(box.x - pad)),
      y: Math.max(0, Math.floor(box.y - pad)),
      width: Math.min(Math.floor(box.width + pad * 2), viewport.width - Math.max(0, Math.floor(box.x - pad))),
      height: Math.min(Math.floor(box.height + pad * 2), viewport.height - Math.max(0, Math.floor(box.y - pad))),
    };

    await page.screenshot({ path: screenshotPath, clip }).catch(() => {});
    if (await fileExists(screenshotPath)) {
      console.log(`账号 [${accountName}] 已保存刷脸二维码截图: ${screenshotPath}`);
      return screenshotPath;
    }
  }

  return captureVerifyDialogScreenshot(page, paths, accountName, "face-verify");
}

async function hasVisibleQr(page) {
  const qrSelectors = [
    "img[src*='qrcode']",
    "img[alt*='二维码']",
    "[class*='qrcode'] img",
    "[class*='qrcode'] canvas",
    "canvas",
  ];
  for (const selector of qrSelectors) {
    const visible = await page.locator(selector).first().isVisible({ timeout: 500 }).catch(() => false);
    if (visible) {
      return true;
    }
  }
  return false;
}

async function handleFaceVerificationIfPresent(page, paths, accountName) {
  const identityVisible = await page.locator("text=身份验证").first().isVisible({ timeout: 800 }).catch(() => false);
  if (identityVisible) {
    const faceEntry = page.getByText("手机刷脸验证").first();
    const faceEntryVisible = await faceEntry.isVisible({ timeout: 600 }).catch(() => false);
    if (faceEntryVisible) {
      await faceEntry.click().catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  const faceTitleVisible = await page.locator("text=手机刷脸验证").first().isVisible({ timeout: 800 }).catch(() => false);
  if (!faceTitleVisible) {
    return false;
  }

  const qrVisible = await hasVisibleQr(page);
  if (!qrVisible) {
    return false;
  }

  loginStageHintByAccount.set(accountName, "当前处于手机刷脸验证阶段");
  if (faceNotifySentByAccount.has(accountName)) {
    return true;
  }

  const screenshotPath = await captureFaceQrScreenshot(page, paths, accountName);
  await sendFaceVerifyEmail({
    accountName,
    screenshotPath,
    reason: "检测到手机刷脸验证弹窗",
  }).catch((error) => {
    console.error(`账号 [${accountName}] 发送刷脸验证邮件失败:`, error.message || error);
  });
  faceNotifySentByAccount.add(accountName);
  return true;
}

async function resendLoginReminderByStage(page, paths, accountName, baseReason) {
  const stageHint = loginStageHintByAccount.get(accountName) || "";

  if (stageHint.includes("手机刷脸验证")) {
    const screenshotPath = await captureFaceQrScreenshot(page, paths, accountName);
    await sendFaceVerifyEmail({
      accountName,
      screenshotPath,
      reason: `${baseReason}（刷脸二维码可能过期，定时重发）`,
    }).catch((error) => {
      console.error(`账号 [${accountName}] 刷脸重发邮件失败:`, error.message || error);
    });
    return;
  }

  const resendReason = stageHint
    ? `${baseReason}（${stageHint}，二维码可能过期，定时重发）`
    : `${baseReason}（二维码可能过期，定时重发）`;
  await notifyLoginRequired(page, paths, accountName, resendReason);
}

async function handleSmsVerificationIfPresent(page, paths, accountName) {
  const smsTitleVisible = await page.locator("text=发送短信验证").first().isVisible({ timeout: 800 }).catch(() => false);
  const identityVisible = await page.locator("text=身份验证").first().isVisible({ timeout: 800 }).catch(() => false);
  if (!smsTitleVisible && !identityVisible) {
    return false;
  }

  if (identityVisible && !smsTitleVisible) {
    const hasFaceEntry = await page.getByText("手机刷脸验证").first().isVisible({ timeout: 400 }).catch(() => false);
    if (hasFaceEntry) {
      return false;
    }

    const smsEntry = page.getByText("发送短信验证").first();
    const entryVisible = await smsEntry.isVisible({ timeout: 500 }).catch(() => false);
    if (entryVisible) {
      await smsEntry.click().catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  const panelVisible = await page.locator("text=发送短信验证").first().isVisible({ timeout: 1000 }).catch(() => false);
  if (!panelVisible) {
    return false;
  }

  loginStageHintByAccount.set(accountName, "当前处于短信验证阶段");
  const screenshotPath = await captureVerifyDialogScreenshot(page, paths, accountName, "sms-verify");

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const phoneMatch = bodyText.match(/请使用手机号\s*([0-9*]+)\s*发送短信验证/);
  const smsContentMatch = bodyText.match(/编辑短信内容[:：]\s*([A-Za-z0-9]+)/);
  const smsTargetMatch = bodyText.match(/发送至[:：]\s*([0-9]+)/);

  const maskedPhone = phoneMatch ? phoneMatch[1] : "";
  const smsContent = smsContentMatch ? smsContentMatch[1] : "";
  const smsTarget = smsTargetMatch ? smsTargetMatch[1] : "";

  const notifyKey = `${accountName}:${maskedPhone}:${smsContent}:${smsTarget}`;
  if (smsNotifySentByAccount.has(notifyKey)) {
    return true;
  }

  await sendSmsVerifyEmail({
    accountName,
    screenshotPath,
    maskedPhone,
    smsContent,
    smsTarget,
  }).catch((error) => {
    console.error(`账号 [${accountName}] 发送短信验证邮件失败:`, error.message || error);
  });

  smsNotifySentByAccount.add(notifyKey);
  return true;
}

async function clickIfVisible(locator, timeout = 3500) {
  if (await locator.first().isVisible({ timeout }).catch(() => false)) {
    await locator.first().click();
    return true;
  }
  return false;
}

async function notifyLoginRequired(page, paths, accountName, reason) {
  const screenshotPath = await captureLoginQrScreenshot(page, paths, accountName);
  await sendAlertEmail({ accountName, screenshotPath, reason }).catch((error) => {
    console.error(`账号 [${accountName}] 邮件发送失败:`, error.message || error);
  });
}

async function waitForManualLoginFlow(
  page,
  paths,
  accountName,
  reason,
  timeoutMs = LOGIN_WAIT_TIMEOUT_MS,
  resendEveryMs = LOGIN_REMIND_INTERVAL_MS
) {
  console.log(`账号 [${accountName}] 等待手动完成登录（扫码 + 验证）。`);
  const start = Date.now();
  let lastNotifyAt = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isLoggedInAtTarget(page)) {
      return;
    }

    await handleFaceVerificationIfPresent(page, paths, accountName);
    await handleSmsVerificationIfPresent(page, paths, accountName);

    if (Date.now() - lastNotifyAt >= resendEveryMs) {
      console.log(`账号 [${accountName}] 仍未登录，重新截图并发送提醒邮件。`);
      await resendLoginReminderByStage(page, paths, accountName, reason);
      lastNotifyAt = Date.now();
    }
    await page.waitForTimeout(1200);
  }
  throw new Error(`账号 [${accountName}] 等待登录超时（${Math.floor(timeoutMs / 60000)} 分钟）。`);
}

async function openTargetAndEnsureLogin(page, paths, accountName, options) {
  const { hasStoredAuth, forceManualLogin, manualLoginReason } = options;
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  if (forceManualLogin) {
    console.log(`账号 [${accountName}] 当前无有效登录态，需手动扫码并完成验证。`);
    const reason = manualLoginReason || "需要手动登录目标账号";
    await notifyLoginRequired(page, paths, accountName, reason);
    await waitForManualLoginFlow(page, paths, accountName, reason);
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(900);
    return;
  }

  if (await isLoggedInAtTarget(page)) {
    console.log(`账号 [${accountName}] 检测到已登录，复用本地会话。`);
    return;
  }

  const reason = hasStoredAuth ? "cookies/storageState 失效或已过期" : "本地 cookies/storageState 不存在";
  await notifyLoginRequired(page, paths, accountName, reason);
  await waitForManualLoginFlow(page, paths, accountName, reason);
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);
}

async function saveAuth(context, paths, accountName) {
  const cookies = await context.cookies();
  await context.storageState({ path: paths.storageStatePath });
  await fs.writeFile(paths.cookiesPath, JSON.stringify(cookies, null, 2), "utf-8");
  console.log(`账号 [${accountName}] 登录态已保存:`);
  console.log(`- storageState: ${paths.storageStatePath}`);
  console.log(`- cookies: ${paths.cookiesPath}`);
  console.log(`- cookie 数量: ${cookies.length}`);
}

async function exportPostListData(page, paths, accountName) {
  const tabClicked =
    (await clickIfVisible(page.getByRole("tab", { name: "投稿列表" }), 2500)) ||
    (await clickIfVisible(page.getByText("投稿列表"), 2500));

  if (!tabClicked) {
    throw new Error("未找到“投稿列表”标签，请确认页面结构是否变化。");
  }

  await page.waitForTimeout(800);

  let exportBtn = page.getByRole("button", { name: /导出/ }).first();
  const roleBtnVisible = await exportBtn.isVisible({ timeout: 2500 }).catch(() => false);
  if (!roleBtnVisible) {
    exportBtn = page.locator("button:has-text('导出数据')").first();
  }

  if (!(await exportBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error("未找到“导出”按钮，请确认账号权限或页面加载状态。");
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await exportBtn.click();
  const download = await downloadPromise;

  const rawName = download.suggestedFilename() || `douyin-content-${Date.now()}.xlsx`;
  const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const savePath = path.join(paths.dataDir, `${timestamp}-${safeName}`);
  await download.saveAs(savePath);

  console.log(`账号 [${accountName}] 导出成功:`);
  console.log(`- 文件路径: ${savePath}`);
}

async function listAccountDirs() {
  await ensureDir(ACCOUNTS_DIR);
  const entries = await fs.readdir(ACCOUNTS_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function parseCliCommand() {
  const args = process.argv.slice(2);
  const command = (args[0] || "export").toLowerCase();
  if (!["add", "export", "list"].includes(command)) {
    throw new Error("只支持三种命令: add / export / list。示例: npm run add -- 账号A / npm run export / npm run list");
  }
  const accountName = normalizeAccountName(args.slice(1).join(" ").trim());
  return { command, accountName };
}

async function resolveAccountsToRun(command, accountNameFromArg) {
  const existingAccounts = await listAccountDirs();
  if (command === "list") {
    return existingAccounts;
  }
  if (command === "add") {
    let accountName = accountNameFromArg;
    if (!accountName) {
      accountName = normalizeAccountName(await promptInput("请输入新增账号标识: "));
    }
    if (!accountName) {
      throw new Error("add 模式必须提供账号标识。示例: npm run add -- 账号A");
    }
    return [accountName];
  }

  if (existingAccounts.length === 0) {
    throw new Error("export 模式未发现账号目录。请先执行 add 命令完成扫码登录。");
  }
  return existingAccounts;
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

async function runOneAccount(browser, accountName, command, options = {}) {
  const paths = getAccountPaths(accountName);
  await ensureDir(paths.accountDir);
  await ensureDir(paths.dataDir);
  await ensureDir(paths.alertDir);
  const hasStoredAuth = await fileExists(paths.storageStatePath);
  const useStoredAuth = typeof options.useStoredAuth === "boolean" ? options.useStoredAuth : command === "export" && hasStoredAuth;
  const forceManualLogin = typeof options.forceManualLogin === "boolean" ? options.forceManualLogin : command === "add";
  const manualLoginReason = options.manualLoginReason;

  const context = await browser.newContext({
    viewport: BROWSER_VIEWPORT,
    acceptDownloads: true,
    storageState: useStoredAuth ? paths.storageStatePath : undefined,
  });

  try {
    const page = await context.newPage();
    console.log(`\n========== 开始处理账号: ${accountName} (${command}) ==========`);
    await openTargetAndEnsureLogin(page, paths, accountName, {
      hasStoredAuth,
      forceManualLogin,
      manualLoginReason,
    });
    await saveAuth(context, paths, accountName);
    await exportPostListData(page, paths, accountName);
    console.log(`========== 账号完成: ${accountName} ==========\n`);
    return { accountName, ok: true };
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
    const result = await runOneAccount(browser, accountName, command, options);
    results.push(result);
  }
  return results;
}

async function main() {
  const { command, accountName } = parseCliCommand();
  const accounts = await resolveAccountsToRun(command, accountName);

  if (command === "list") {
    console.log(`当前账号数量: ${accounts.length}`);
    if (accounts.length === 0) {
      console.log("未找到账号目录。可先执行: npm run add -- 账号A");
      return;
    }

    console.log("\n账号状态:");
    for (const name of accounts) {
      const paths = getAccountPaths(name);
      const hasStorage = await fileExists(paths.storageStatePath);
      const hasCookies = await fileExists(paths.cookiesPath);
      console.log(`- ${name} | storageState: ${hasStorage ? "yes" : "no"} | cookies: ${hasCookies ? "yes" : "no"}`);
    }
    return;
  }

  console.log(`当前命令: ${command}`);
  console.log(`本次将处理 ${accounts.length} 个账号: ${accounts.join(", ")}`);

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"],
  });

  let results = [];
  if (command === "export") {
    const { withAuth, withoutAuth } = await splitAccountsByStorageState(accounts);
    console.log(`导出通道A(已有登录态): ${withAuth.length} 个账号`);
    console.log(`导出通道B(需登录验证): ${withoutAuth.length} 个账号`);

    const [authResults, loginResults] = await Promise.all([
      runAccountQueue(browser, withAuth, command, { useStoredAuth: true, forceManualLogin: false }),
      runAccountQueue(browser, withoutAuth, command, {
        useStoredAuth: false,
        forceManualLogin: true,
        manualLoginReason: "export 通道B需先完成登录验证",
      }),
    ]);
    results = [...authResults, ...loginResults];
  } else {
    results = await runAccountQueue(browser, accounts, command, {
      forceManualLogin: true,
      useStoredAuth: false,
      manualLoginReason: "add 模式需登录目标账号",
    });
  }

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
}

main().catch(async (error) => {
  console.error("\n脚本执行失败:", error);
  process.exitCode = 1;
});
