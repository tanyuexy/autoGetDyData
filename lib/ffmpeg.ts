import { existsSync } from "fs";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const SYSTEM_CANDIDATES = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
];

let cachedPath: string | null = null;

export function getFfmpegPath(): string {
  if (cachedPath) return cachedPath;

  const fromEnv = String(process.env.FFMPEG_PATH || "").trim();
  if (fromEnv && (fromEnv === "ffmpeg" || existsSync(fromEnv))) {
    cachedPath = fromEnv;
    return cachedPath;
  }

  const bundledPath = String(ffmpegInstaller.path || "").trim();
  if (bundledPath && existsSync(bundledPath)) {
    cachedPath = bundledPath;
    return cachedPath;
  }

  for (const candidate of SYSTEM_CANDIDATES) {
    if (existsSync(candidate)) {
      cachedPath = candidate;
      return cachedPath;
    }
  }

  cachedPath = "ffmpeg";
  return cachedPath;
}
