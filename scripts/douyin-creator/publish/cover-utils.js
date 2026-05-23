const { existsSync } = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const fse = require("fs-extra");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

const execFileAsync = promisify(execFile);

const SYSTEM_FFMPEG_CANDIDATES = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
];

let cachedFfmpegPath = null;

function getFfmpegPath() {
  if (cachedFfmpegPath) return cachedFfmpegPath;

  const fromEnv = String(process.env.FFMPEG_PATH || "").trim();
  if (fromEnv && (fromEnv === "ffmpeg" || existsSync(fromEnv))) {
    cachedFfmpegPath = fromEnv;
    return cachedFfmpegPath;
  }

  const bundledPath = String(ffmpegInstaller.path || "").trim();
  if (bundledPath && existsSync(bundledPath)) {
    cachedFfmpegPath = bundledPath;
    return cachedFfmpegPath;
  }

  for (const candidate of SYSTEM_FFMPEG_CANDIDATES) {
    if (existsSync(candidate)) {
      cachedFfmpegPath = candidate;
      return cachedFfmpegPath;
    }
  }

  cachedFfmpegPath = "ffmpeg";
  return cachedFfmpegPath;
}

async function extractVideoFirstFrameJpeg(videoFilePath, outputDir) {
  if (!(await fse.pathExists(videoFilePath))) {
    throw new Error(`视频文件不存在: ${videoFilePath}`);
  }

  await fse.ensureDir(outputDir);
  const outFile = path.join(outputDir, `cover-frame-${Date.now()}.jpg`);
  const ffmpegPath = getFfmpegPath();
  const vf = "scale=w='max(1001,iw)':h='max(753,ih)':force_original_aspect_ratio=increase";

  await execFileAsync(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    "0",
    "-i",
    videoFilePath,
    "-frames:v",
    "1",
    "-vf",
    vf,
    "-q:v",
    "2",
    "-y",
    outFile,
  ]);

  if (!(await fse.pathExists(outFile))) {
    throw new Error("ffmpeg 未能从视频提取首帧封面");
  }

  return outFile;
}

module.exports = {
  getFfmpegPath,
  extractVideoFirstFrameJpeg,
};
