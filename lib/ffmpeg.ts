import { existsSync } from "fs";
import { createRequire } from "module";

const SYSTEM_CANDIDATES = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
];

let cachedPath: string | null = null;

function resolveBundledFfmpegPath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const installer = require("@ffmpeg-installer/ffmpeg") as { path?: string };
    const bundledPath = String(installer.path || "").trim();
    if (bundledPath && existsSync(bundledPath)) {
      return bundledPath;
    }
  } catch {
    /* 打包/开发环境未安装时忽略 */
  }
  return null;
}

export function getFfmpegPath(): string {
  if (cachedPath) return cachedPath;

  const fromEnv = String(process.env.FFMPEG_PATH || "").trim();
  if (fromEnv && (fromEnv === "ffmpeg" || existsSync(fromEnv))) {
    cachedPath = fromEnv;
    return cachedPath;
  }

  const bundledPath = resolveBundledFfmpegPath();
  if (bundledPath) {
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
