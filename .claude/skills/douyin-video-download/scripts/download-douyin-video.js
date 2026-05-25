#!/usr/bin/env node
const path = require("path");
const fse = require("fs-extra");
const { chromium } = require("playwright");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ACCOUNTS_DIR = path.join(REPO_ROOT, "storage/creator-accounts");

function parseArgs(argv) {
  const args = argv.slice(2);
  let url = "", account = "", output = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-a" || arg === "--account") account = args[++i] || "";
    else if (arg === "-o" || arg === "--output") output = args[++i] || "";
    else if (!arg.startsWith("-") && !url) url = arg;
  }
  return { url, account, output };
}

function extractVideoId(input) {
  const raw = String(input || "").trim();
  if (/^\d+$/.test(raw)) return raw;
  const modalMatch = raw.match(/modal_id=(\d+)/);
  if (modalMatch) return modalMatch[1];
  const videoMatch = raw.match(/\/video\/(\d+)/);
  if (videoMatch) return videoMatch[1];
  return "";
}

async function listAccountsWithStorage() {
  if (!(await fse.pathExists(ACCOUNTS_DIR))) return [];
  const entries = await fse.readdir(ACCOUNTS_DIR, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const storagePath = path.join(ACCOUNTS_DIR, entry.name, "storageState.json");
    if (await fse.pathExists(storagePath)) names.push(entry.name);
  }
  return names.sort();
}

function cookiesHeaderFromStorageState(storageState) {
  return (storageState.cookies || [])
    .filter((c) => String(c.domain || "").includes("douyin.com"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

async function resolveFinalVideoUrl(page, inputUrl) {
  await page.goto(inputUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  const currentUrl = page.url();
  let videoId = extractVideoId(currentUrl) || extractVideoId(inputUrl);
  if (!currentUrl.includes("/video/") && videoId) {
    await page.goto(`https://www.douyin.com/video/${videoId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);
  }
  videoId = extractVideoId(page.url()) || videoId;
  const videoSrc = await page.locator("video").first().evaluate((el) => String(el.currentSrc || el.src || "").trim()).catch(() => "");
  if (videoSrc && videoSrc.startsWith("http")) return { videoId, videoSrc };
  const sniffed = await page.evaluate(() => {
    const entries = performance.getEntriesByType("resource") || [];
    const urls = entries.map((e) => e.name).filter((name) => /\/video\/|mime_type=video|\.mp4/.test(name));
    return urls.length ? urls[urls.length - 1] : "";
  });
  return { videoId, videoSrc: sniffed || "" };
}

async function downloadBinary(url, outputPath, headers) {
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fse.ensureDir(path.dirname(outputPath));
  await fse.writeFile(outputPath, buf);
  return buf.length;
}

async function main() {
  const { url, account, output } = parseArgs(process.argv);
  if (!url) { console.error(JSON.stringify({ ok: false, error: "缺少 Douyin 视频 URL" })); process.exit(1); }
  const accounts = await listAccountsWithStorage();
  if (accounts.length === 0) { console.error(JSON.stringify({ ok: false, error: "未找到账号目录 storageState.json" })); process.exit(1); }
  const accountName = account && accounts.includes(account) ? account : accounts[0];
  const storagePath = path.join(ACCOUNTS_DIR, accountName, "storageState.json");
  const storageState = JSON.parse(await fse.readFile(storagePath, "utf8"));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: storagePath });
  const page = await context.newPage();
  try {
    const { videoId, videoSrc } = await resolveFinalVideoUrl(page, url);
    if (!videoSrc) throw new Error("未能从页面获取视频地址，请尝试刷新登录态后重试");
    const outputPath = output ? path.resolve(output) : path.resolve(process.cwd(), `${videoId || "douyin-video"}.mp4`);
    const cookieHeader = cookiesHeaderFromStorageState(storageState);
    const bytes = await downloadBinary(videoSrc, outputPath, {
      Referer: "https://www.douyin.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    });
    console.log(JSON.stringify({ ok: true, account: accountName, videoId: videoId || null, videoUrl: videoSrc, output: outputPath, bytes }));
  } finally { await browser.close(); }
}

main().catch((err) => { console.error(JSON.stringify({ ok: false, error: err.message || String(err) })); process.exit(1); });
