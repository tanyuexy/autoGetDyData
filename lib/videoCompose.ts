import { spawn } from "child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import { applyRandomBackgroundMusic } from "@/lib/composeMusic";
import { archiveComposedFilmFile, getComposedFilmsDir } from "@/lib/aiVideoMedia";
import { getFfmpegPath } from "@/lib/ffmpeg";
import {
  computeMaxRandomCombinations,
  generateRandomCombos,
  type ComposeBatchResult,
  type ComposeFilmResult,
  type ComposeGroupInput,
  type ComposeRequest,
  type ComposeSegmentInput,
} from "@/lib/videoComposeShared";

export type {
  ComposeBatchResult,
  ComposeFilmResult,
  ComposeGroupInput,
  ComposeMode,
  ComposeRequest,
  ComposeSegmentInput,
  RandomComposeRequest,
  SequentialComposeRequest,
} from "@/lib/videoComposeShared";

function runCommand(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd });
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

async function downloadSegment(url: string, filePath: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载片段失败：HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(filePath, buffer);
}

async function materializeSegment(url: string, filePath: string) {
  const trimmed = url.trim();
  if (trimmed.startsWith("/")) {
    const localPath = path.join(process.cwd(), "public", trimmed);
    if (existsSync(localPath)) {
      await copyFile(localPath, filePath);
      return;
    }
    const origin = (process.env.PUBLIC_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
    await downloadSegment(`${origin}${trimmed}`, filePath);
    return;
  }
  await downloadSegment(trimmed, filePath);
}

function toConcatFileLine(filePath: string) {
  const escaped = filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
  return `file '${escaped}'`;
}

async function concatLocalFiles(inputFiles: string[], outputPath: string) {
  const ffmpegPath = getFfmpegPath();
  const listPath = `${outputPath}.concat.txt`;
  await writeFile(listPath, inputFiles.map(toConcatFileLine).join("\n"));

  try {
    await runCommand(
      ffmpegPath,
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outputPath],
      process.cwd()
    );
  } catch {
    await runCommand(
      ffmpegPath,
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      process.cwd()
    );
  } finally {
    await rm(listPath, { force: true }).catch(() => {});
  }

  if (!existsSync(outputPath)) {
    throw new Error("合成完成但没有生成输出文件");
  }
}


async function maybeApplyBackgroundMusic(outputPath: string, enabled: boolean): Promise<string | null> {
  if (!enabled) return null;
  try {
    return await applyRandomBackgroundMusic(outputPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "合成背景音乐失败";
    throw new Error(message);
  }
}

async function composeSegmentsToFile(segments: ComposeSegmentInput[], outputPath: string) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "seedance-compose-"));
  try {
    const inputFiles: string[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      const filePath = path.join(tmpDir, `clip-${String(i + 1).padStart(2, "0")}.mp4`);
      await materializeSegment(segments[i].videoUrl, filePath);
      inputFiles.push(filePath);
    }
    await concatLocalFiles(inputFiles, outputPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function composeSequentialFilm(
  segments: ComposeSegmentInput[],
  addBackgroundMusic = true
): Promise<ComposeFilmResult> {
  if (segments.length < 2) {
    throw new Error("至少选择 2 个有视频 URL 的片段");
  }

  const outputDir = getComposedFilmsDir();
  await mkdir(outputDir, { recursive: true });
  const filename = `seedance-film-${Date.now()}.mp4`;
  const outputPath = path.join(outputDir, filename);

  await composeSegmentsToFile(segments.slice(0, 30), outputPath);
  const backgroundMusic = await maybeApplyBackgroundMusic(outputPath, addBackgroundMusic);
  const videoUrl = await archiveComposedFilmFile(outputPath, filename);

  return {
    videoUrl,
    segmentCount: segments.length,
    mode: "sequential",
    backgroundMusic,
    segments: segments.slice(0, 30),
  };
}

export async function composeRandomFilms(
  groups: ComposeGroupInput[],
  outputCount: number,
  orderRule?: string,
  addBackgroundMusic = true
): Promise<ComposeBatchResult> {
  if (groups.length < 2) {
    throw new Error("随机混剪至少需要 2 个分组，且每组至少 1 个片段");
  }
  if (groups.some((group) => group.segments.length === 0)) {
    throw new Error("存在空分组，请确保每个分组都有可用片段");
  }

  const count = Number(outputCount);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("产出数量必须是大于 0 的整数");
  }
  if (count > 30) {
    throw new Error("单次最多生成 30 条成片");
  }

  const maxCombinations = computeMaxRandomCombinations(groups, orderRule);
  if (maxCombinations > BigInt(0) && BigInt(count) > maxCombinations) {
    throw new Error(`请求数量 ${count} 超过最大可生成组合数 ${maxCombinations.toString()}`);
  }

  const combos = generateRandomCombos(groups, count, orderRule);
  const outputDir = getComposedFilmsDir();
  await mkdir(outputDir, { recursive: true });
  const batchTs = Date.now();

  const films: ComposeFilmResult[] = [];
  for (let i = 0; i < combos.length; i += 1) {
    const filename = `seedance-film-${batchTs}-${String(i + 1).padStart(3, "0")}.mp4`;
    const outputPath = path.join(outputDir, filename);
    await composeSegmentsToFile(combos[i].segments, outputPath);
    const backgroundMusic = await maybeApplyBackgroundMusic(outputPath, addBackgroundMusic);
    const videoUrl = await archiveComposedFilmFile(outputPath, filename);
    films.push({
      videoUrl,
      segmentCount: combos[i].segments.length,
      mode: "random",
      comboIndex: i + 1,
      backgroundMusic,
      segments: combos[i].segments,
    });
  }

  return {
    mode: "random",
    films,
    generated: films.length,
  };
}

export async function runComposeRequest(request: ComposeRequest): Promise<ComposeBatchResult> {
  if (request.mode === "sequential") {
    const film = await composeSequentialFilm(request.segments, request.addBackgroundMusic !== false);
    return {
      mode: "sequential",
      films: [film],
      generated: 1,
    };
  }

  return composeRandomFilms(
    request.groups,
    request.outputCount,
    request.orderRule,
    request.addBackgroundMusic !== false
  );
}
