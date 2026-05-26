#!/usr/bin/env node
/**
 * Seedance 视频拆解：探测元数据、采样帧、按片段截取首尾帧。
 * 依赖系统 ffmpeg / ffprobe。
 */
const path = require("path");
const fse = require("fs-extra");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    command: "help",
    video: "",
    outDir: "",
    segmentsFile: "",
    sampleInterval: 0.5,
    sampleMaxSec: 20,
    videoId: "",
  };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "probe" || arg === "sample" || arg === "extract" || arg === "run") {
      opts.command = arg;
    } else if (arg === "-o" || arg === "--out-dir") {
      opts.outDir = args[++i] || "";
    } else if (arg === "-s" || arg === "--segments") {
      opts.segmentsFile = args[++i] || "";
    } else if (arg === "--interval") {
      opts.sampleInterval = Number(args[++i]) || 0.5;
    } else if (arg === "--max-sec") {
      opts.sampleMaxSec = Number(args[++i]) || 20;
    } else if (arg === "--id") {
      opts.videoId = args[++i] || "";
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }
  if (!opts.video && positional[0]) opts.video = positional[0];
  return opts;
}

function basenameWithoutExt(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

async function runFfprobe(videoPath) {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", videoPath],
    { maxBuffer: 10 * 1024 * 1024 }
  );
  const data = JSON.parse(stdout);
  const videoStream = (data.streams || []).find((s) => s.codec_type === "video");
  const audioStream = (data.streams || []).find((s) => s.codec_type === "audio");
  const duration = Number(data.format?.duration || videoStream?.duration || 0);
  const width = Number(videoStream?.width || 0);
  const height = Number(videoStream?.height || 0);
  let ratio = "unknown";
  if (width && height) {
    const r = width / height;
    if (Math.abs(r - 9 / 16) < 0.05) ratio = "9:16";
    else if (Math.abs(r - 16 / 9) < 0.05) ratio = "16:9";
    else if (Math.abs(r - 1) < 0.05) ratio = "1:1";
    else ratio = `${width}:${height}`;
  }
  return {
    durationSec: Math.round(duration * 1000) / 1000,
    width,
    height,
    ratio,
    hasAudio: Boolean(audioStream),
    codec: videoStream?.codec_name || "",
  };
}

async function extractFrame(videoPath, timestampSec, outputPath) {
  await fse.ensureDir(path.dirname(outputPath));
  await execFileAsync(
    "ffmpeg",
    ["-y", "-ss", String(timestampSec), "-i", videoPath, "-frames:v", "1", "-q:v", "2", outputPath],
    { maxBuffer: 5 * 1024 * 1024 }
  );
}

async function cmdProbe(videoPath, outDir) {
  const meta = await runFfprobe(videoPath);
  const payload = {
    ok: true,
    video: path.resolve(videoPath),
    videoId: basenameWithoutExt(videoPath),
    ...meta,
  };
  if (outDir) {
    await fse.ensureDir(outDir);
    await fse.writeJson(path.join(outDir, "probe.json"), payload, { spaces: 2 });
  }
  console.log(JSON.stringify(payload));
  return payload;
}

async function cmdSample(videoPath, outDir, interval, maxSec) {
  const meta = await runFfprobe(videoPath);
  const sampleDir = path.join(outDir, "_samples");
  await fse.emptyDir(sampleDir);
  const end = Math.min(meta.durationSec, maxSec);
  const frames = [];
  for (let t = 0; t <= end + 0.001; t += interval) {
    const ts = Math.round(t * 10) / 10;
    const name = `t_${String(ts).replace(".", "_")}.jpg`;
    const framePath = path.join(sampleDir, name);
    await extractFrame(videoPath, ts, framePath);
    frames.push({ sec: ts, file: path.relative(outDir, framePath) });
  }
  const payload = {
    ok: true,
    video: path.resolve(videoPath),
    sampleDir: path.resolve(sampleDir),
    intervalSec: interval,
    maxSec: end,
    frames,
  };
  await fse.writeJson(path.join(outDir, "samples-index.json"), payload, { spaces: 2 });
  console.log(JSON.stringify(payload));
  return payload;
}

function normalizeSegment(seg, index) {
  const id = String(seg.id || seg.key || `seg-${index + 1}`).padStart(2, "0");
  const label = String(seg.label || seg.name || `片段${index + 1}`);
  const startSec = Number(seg.startSec ?? seg.start ?? 0);
  const endSec = Number(seg.endSec ?? seg.end ?? startSec);
  const seedanceSlice = seg.seedanceSlice || seg.promptSlice || "";
  return { id, label, startSec, endSec, seedanceSlice };
}

async function cmdExtract(videoPath, outDir, segmentsFile) {
  const raw = await fse.readJson(segmentsFile);
  const segments = (raw.segments || []).map(normalizeSegment);
  if (!segments.length) throw new Error("segments.json 中 segments 为空");

  await fse.ensureDir(outDir);
  const extracted = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const order = String(i + 1).padStart(2, "0");
    const slug = `${order}-${seg.label}`.replace(/[\\/:*?"<>|]/g, "-");
    const firstPath = path.join(outDir, `${slug}-首帧.jpg`);
    const lastPath = path.join(outDir, `${slug}-尾帧.jpg`);
    await extractFrame(videoPath, seg.startSec, firstPath);
    await extractFrame(videoPath, seg.endSec, lastPath);
    extracted.push({
      ...seg,
      firstFrame: path.resolve(firstPath),
      lastFrame: path.resolve(lastPath),
    });
  }

  const manifest = {
    ok: true,
    video: path.resolve(videoPath),
    outDir: path.resolve(outDir),
    targetDurationSec: raw.targetDurationSec ?? 15,
    seedancePrompt: raw.seedancePrompt || "",
    segments: extracted,
  };
  await fse.writeJson(path.join(outDir, "manifest.json"), manifest, { spaces: 2 });
  console.log(JSON.stringify(manifest));
  return manifest;
}

async function cmdRun(opts) {
  const videoPath = path.resolve(opts.video);
  if (!(await fse.pathExists(videoPath))) throw new Error(`视频不存在: ${videoPath}`);

  const videoId = opts.videoId || basenameWithoutExt(videoPath);
  const outDir =
    opts.outDir || path.join(path.dirname(videoPath), `${videoId}-seedance-decompose`);

  await fse.ensureDir(outDir);
  await cmdProbe(videoPath, outDir);
  await cmdSample(videoPath, outDir, opts.sampleInterval, opts.sampleMaxSec);

  if (opts.segmentsFile) {
    await cmdExtract(videoPath, path.join(outDir, "frames"), opts.segmentsFile);
  }

  console.log(
    JSON.stringify({
      ok: true,
      outDir: path.resolve(outDir),
      nextStep: opts.segmentsFile
        ? "done"
        : "Agent: 阅读 _samples 帧图，编写 segments.json 后执行 extract",
    })
  );
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.command === "help" || !opts.video) {
    console.log(`Usage:
  node decompose-video-for-seedance.js probe <video.mp4> [-o outDir]
  node decompose-video-for-seedance.js sample <video.mp4> -o outDir [--interval 0.5] [--max-sec 20]
  node decompose-video-for-seedance.js extract <video.mp4> -s segments.json -o framesDir
  node decompose-video-for-seedance.js run <video.mp4> [-o outDir] [-s segments.json]

segments.json 见 skill REFERENCE.md`);
    process.exit(opts.command === "help" ? 0 : 1);
  }

  const videoPath = path.resolve(opts.video);
  if (!(await fse.pathExists(videoPath))) {
    console.error(JSON.stringify({ ok: false, error: `视频不存在: ${videoPath}` }));
    process.exit(1);
  }

  try {
    if (opts.command === "probe") {
      await cmdProbe(videoPath, opts.outDir || "");
    } else if (opts.command === "sample") {
      const outDir =
        opts.outDir || path.join(path.dirname(videoPath), `${basenameWithoutExt(videoPath)}-seedance-decompose`);
      await cmdSample(videoPath, outDir, opts.sampleInterval, opts.sampleMaxSec);
    } else if (opts.command === "extract") {
      if (!opts.segmentsFile) throw new Error("extract 需要 -s segments.json");
      const outDir = opts.outDir || path.join(path.dirname(opts.segmentsFile), "frames");
      await cmdExtract(videoPath, outDir, opts.segmentsFile);
    } else if (opts.command === "run") {
      await cmdRun(opts);
    } else {
      throw new Error(`未知命令: ${opts.command}`);
    }
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message || String(e) }));
    process.exit(1);
  }
}

main();
