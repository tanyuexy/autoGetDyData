import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdir, mkdtemp, rm, writeFile, copyFile } from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import path from "path";

export const runtime = "nodejs";

interface ComposeSegmentInput {
  id: string;
  name: string;
  videoUrl: string;
}

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

export async function POST(request: NextRequest) {
  let tmpDir: string | null = null;
  try {
    const body = await request.json();
    const segments = Array.isArray(body.segments)
      ? (body.segments as ComposeSegmentInput[])
          .filter((item) => item?.videoUrl)
          .slice(0, 30)
      : [];

    if (segments.length < 2) {
      return NextResponse.json({ error: "至少选择 2 个有视频 URL 的片段" }, { status: 400 });
    }

    tmpDir = await mkdtemp(path.join(os.tmpdir(), "seedance-compose-"));
    const inputFiles: string[] = [];

    for (let i = 0; i < segments.length; i += 1) {
      const filePath = path.join(tmpDir, `clip-${String(i + 1).padStart(2, "0")}.mp4`);
      await materializeSegment(segments[i].videoUrl, filePath);
      inputFiles.push(filePath);
    }

    const listPath = path.join(tmpDir, "concat.txt");
    await writeFile(
      listPath,
      inputFiles.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n")
    );

    const publicDir = path.join(process.cwd(), "public", "generated-videos");
    await mkdir(publicDir, { recursive: true });
    const filename = `seedance-film-${Date.now()}.mp4`;
    const outputPath = path.join(publicDir, filename);

    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        outputPath,
      ],
      process.cwd()
    ).catch(async () => {
      await runCommand(
        "ffmpeg",
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
    });

    if (!existsSync(outputPath)) {
      throw new Error("合成完成但没有生成输出文件");
    }

    return NextResponse.json({
      ok: true,
      videoUrl: `/generated-videos/${filename}`,
      segmentCount: segments.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "合成视频失败" }, { status: 400 });
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
