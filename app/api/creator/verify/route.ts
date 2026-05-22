import { NextResponse } from "next/server";
import { enqueueTask, generateTaskIdWithTime } from "@/lib/taskManager";
import { getDb } from "@/lib/db/mongo";
import path from "node:path";
import fse from "fs-extra";

async function waitForTaskDone(taskId: string, timeoutMs: number) {
  const db = await getDb();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await db.collection("task_jobs").findOne({ taskId });
    if (!job || job.status === "success") return;
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(job.lastError || `任务${job.status}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("验证超时，请稍后重试");
}

export async function POST(request: Request) {
  try {
    const { accountName } = await request.json();
    if (!accountName) {
      return NextResponse.json({ error: "缺少 accountName 参数" }, { status: 400 });
    }

    const ACCOUNTS_DIR = (() => {
      const envVal = process.env.CREATOR_ACCOUNTS_DIR;
      if (envVal) return path.resolve(process.cwd(), envVal);
      const newPath = path.resolve(process.cwd(), "storage/creator-accounts");
      const oldPath = path.resolve(process.cwd(), "accounts");
      if (fse.existsSync(oldPath) && !fse.existsSync(newPath)) return oldPath;
      return newPath;
    })();

    const normalized = String(accountName).trim().replace(/[\\/:*?"<>|]/g, "_");
    const storagePath = path.join(ACCOUNTS_DIR, normalized, "storageState.json");

    if (!fse.existsSync(storagePath)) {
      return NextResponse.json({
        accountName,
        verified: false,
        status: "missing",
        detail: "未找到 storageState.json 文件",
      });
    }

    const taskId = generateTaskIdWithTime("creator-verify");
    await enqueueTask(taskId, "node", ["scripts/run.js", "creator:verify", normalized], {
      namespace: "verify",
      timeoutMs: 2 * 60 * 1000,
    });

    await waitForTaskDone(taskId, 2 * 60 * 1000);

    const vp = path.join(ACCOUNTS_DIR, normalized, "verified-at.json");
    if (fse.existsSync(vp)) {
      const result = JSON.parse(fse.readFileSync(vp, "utf-8"));
      return NextResponse.json({ accountName, ...result });
    }

    return NextResponse.json({
      accountName,
      verified: false,
      status: "error",
      detail: "验证完成但未找到结果文件",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "验证失败" }, { status: 500 });
  }
}
