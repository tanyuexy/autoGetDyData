#!/usr/bin/env node
const { existsSync } = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const fse = require("fs-extra");
const { chromium } = require("playwright");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ACCOUNTS_DIR = path.join(REPO_ROOT, "storage/creator-accounts");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "storage/downloads");
const SYSTEM_FFMPEG_CANDIDATES = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
let cachedFfmpegPath = null;

function getFfmpegPath() {
  if (cachedFfmpegPath) return cachedFfmpegPath;
  const fromEnv = String(process.env.FFMPEG_PATH || "").trim();
  if (fromEnv && (fromEnv === "ffmpeg" || existsSync(fromEnv))) return (cachedFfmpegPath = fromEnv);
  const bundledPath = String(ffmpegInstaller.path || "").trim();
  if (bundledPath && existsSync(bundledPath)) return (cachedFfmpegPath = bundledPath);
  for (const candidate of SYSTEM_FFMPEG_CANDIDATES) {
    if (existsSync(candidate)) return (cachedFfmpegPath = candidate);
  }
  return (cachedFfmpegPath = "ffmpeg");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let url = "", account = "", output = "", noConvert = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-a" || arg === "--account") account = args[++i] || "";
    else if (arg === "-o" || arg === "--output") output = args[++i] || "";
    else if (arg === "--no-convert") noConvert = true;
    else if (!arg.startsWith("-") && !url) url = arg;
  }
  return { url, account, output, noConvert };
}

function sanitizeFilename(name) {
  return String(name || "douyin-audio").trim().replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").slice(0, 120);
}

function extractMusicId(input) {
  const raw = String(input || "").trim();
  if (/^\d+$/.test(raw)) return raw;
  const musicMatch = raw.match(/\/music\/(\d+)/);
  return musicMatch ? musicMatch[1] : "";
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

async function resolveMusicId(page, inputUrl) {
  const directId = extractMusicId(inputUrl);
  if (directId) return directId;
  await page.goto(inputUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  const fromFinalUrl = extractMusicId(page.url());
  if (fromFinalUrl) return fromFinalUrl;
  throw new Error("未能解析 music_id，请确认链接指向抖音音乐页 /music/<id>");
}

async function fetchMusicDetail(page, musicId) {
  const musicUrl = `https://www.douyin.com/music/${musicId}`;
  if (!page.url().includes(`/music/${musicId}`)) {
    await page.goto(musicUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
  }
  const detail = await page.evaluate(async (id) => {
    const params = new URLSearchParams({
      device_platform: "webapp", aid: "6383", channel: "channel_pc_web",
      music_id: id, version_code: "170400", version_name: "17.4.0",
      cookie_enabled: "true", platform: "PC",
    });
    const res = await fetch(`/aweme/v1/web/music/detail/?${params.toString()}`, { credentials: "include" });
    return res.json();
  }, musicId);
  const musicInfo = detail?.music_info;
  if (!musicInfo) throw new Error("music detail API 未返回 music_info");
  const playUrl = musicInfo.play_url?.url_list?.[0] || musicInfo.play_url?.uri || musicInfo.playUrl?.url_list?.[0] || musicInfo.playUrl?.uri || "";
  if (!playUrl || !String(playUrl).startsWith("http")) throw new Error("未获取到 play_url，请尝试刷新登录态后重试");
  return { musicId, title: musicInfo.title || musicId, author: musicInfo.author || musicInfo.owner_nickname || "", duration: musicInfo.duration || null, playUrl };
}

async function downloadBinary(url, outputPath, headers) {
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fse.ensureDir(path.dirname(outputPath));
  await fse.writeFile(outputPath, buf);
  return buf.length;
}

async function convertToMp3(inputPath, outputPath) {
  await execFileAsync(getFfmpegPath(), ["-y", "-i", inputPath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", outputPath]);
}

async function main() {
  const { url, account, output, noConvert } = parseArgs(process.argv);
  if (!url) { console.error(JSON.stringify({ ok: false, error: "缺少 Douyin 音乐 URL 或 music_id" })); process.exit(1); }
  const accounts = await listAccountsWithStorage();
  if (accounts.length === 0) { console.error(JSON.stringify({ ok: false, error: "未找到账号目录 storageState.json" })); process.exit(1); }
  const accountName = account && accounts.includes(account) ? account : accounts[0];
  const storagePath = path.join(ACCOUNTS_DIR, accountName, "storageState.json");
  const storageState = JSON.parse(await fse.readFile(storagePath, "utf8"));
  const cookieHeader = cookiesHeaderFromStorageState(storageState);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: storagePath, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" });
  const page = await context.newPage();
  try {
    const musicId = await resolveMusicId(page, url);
    const meta = await fetchMusicDetail(page, musicId);
    const safeTitle = sanitizeFilename(meta.title);
    const defaultExt = noConvert ? ".bin" : ".mp3";
    const defaultOutput = path.join(DEFAULT_OUTPUT_DIR, `${safeTitle}${defaultExt}`);
    const outputPath = output ? path.resolve(output) : defaultOutput;
    const downloadHeaders = {
      Referer: "https://www.douyin.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    };
    let finalPath = outputPath;
    let bytes = 0;
    if (noConvert) {
      bytes = await downloadBinary(meta.playUrl, finalPath, downloadHeaders);
    } else {
      const rawPath = `${outputPath}.raw`;
      bytes = await downloadBinary(meta.playUrl, rawPath, downloadHeaders);
      await convertToMp3(rawPath, outputPath);
      await fse.remove(rawPath);
      finalPath = outputPath;
      bytes = (await fse.stat(outputPath)).size;
    }
    console.log(JSON.stringify({ ok: true, account: accountName, musicId: meta.musicId, title: meta.title, author: meta.author, duration: meta.duration, playUrl: meta.playUrl, output: finalPath, bytes, converted: !noConvert }));
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(JSON.stringify({ ok: false, error: err.message || String(err) })); process.exit(1); });
