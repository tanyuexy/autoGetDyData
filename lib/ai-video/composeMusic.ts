import { spawn } from "child_process";
import { readdir, rename, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { getFfmpegPath } from "@/lib/ai-video/ffmpeg";

const MUSIC_DIR = path.join(process.cwd(), "public", "music");
const MUSIC_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"]);

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd() });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function probeVideoHasAudio(videoPath: string): Promise<boolean> {
  const ffmpegPath = getFfmpegPath();
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", videoPath], { cwd: process.cwd() });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", () => {
      resolve(/Audio:/i.test(stderr));
    });
    child.on("error", () => resolve(false));
  });
}

export function getComposeMusicDir() {
  return MUSIC_DIR;
}

export async function listComposeMusicFiles(): Promise<string[]> {
  if (!existsSync(MUSIC_DIR)) return [];
  const entries = await readdir(MUSIC_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => MUSIC_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export async function pickRandomComposeMusicPath(): Promise<string | null> {
  const files = await listComposeMusicFiles();
  if (!files.length) return null;
  const picked = files[Math.floor(Math.random() * files.length)];
  return path.join(MUSIC_DIR, picked);
}

export async function mergeBackgroundMusicIntoVideo(
  videoPath: string,
  musicPath: string,
  outputPath: string
) {
  const ffmpegPath = getFfmpegPath();
  const hasAudio = await probeVideoHasAudio(videoPath);

  if (hasAudio) {
    await runCommand(ffmpegPath, [
      "-y",
      "-i",
      videoPath,
      "-stream_loop",
      "-1",
      "-i",
      musicPath,
      "-filter_complex",
      "[1:a]volume=0.35[a1];[0:a][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]",
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    return;
  }

  await runCommand(ffmpegPath, [
    "-y",
    "-i",
    videoPath,
    "-stream_loop",
    "-1",
    "-i",
    musicPath,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

export async function applyRandomBackgroundMusic(videoPath: string): Promise<string | null> {
  const musicPath = await pickRandomComposeMusicPath();
  if (!musicPath) return null;

  const tmpPath = `${videoPath}.bgm.mp4`;
  try {
    await mergeBackgroundMusicIntoVideo(videoPath, musicPath, tmpPath);
    await rename(tmpPath, videoPath);
    return path.basename(musicPath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}
