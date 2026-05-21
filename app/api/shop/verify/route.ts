import { NextResponse } from "next/server";
import { enqueueTask, generateTaskIdWithTime } from "@/lib/taskManager";
import { getDb } from "@/lib/db/mongo";
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
    const { email } = await request.json();
    if (!email) {
      return NextResponse.json({ error: "缺少 email 参数" }, { status: 400 });
    }

    const path = require("path");

    const ACCOUNTS_DIR = (() => {
      const envVal = process.env.SHOP_ACCOUNTS_DIR;
      if (envVal) return path.resolve(process.cwd(), envVal);
      const newPath = path.resolve(process.cwd(), "storage/shop-accounts");
      const oldPath = path.resolve(process.cwd(), "accounts-shop");
      if (fse.existsSync(oldPath) && !fse.existsSync(newPath)) return oldPath;
      return newPath;
    })();

    const dirName = String(email).trim().replace(/[\\/:*?"<>|]+/g, "_");
    const storagePath = path.join(ACCOUNTS_DIR, dirName, "storageState.json");

    if (!fse.existsSync(storagePath)) {
      return NextResponse.json({
        email,
        verified: false,
        status: "missing",
        detail: "未找到 storageState.json 文件",
      });
    }

    const taskId = generateTaskIdWithTime("shop-verify");
    await enqueueTask(taskId, "node", ["scripts/run.js", "shop:verify", email], {
      namespace: "verify",
      timeoutMs: 2 * 60 * 1000,
    });

    await waitForTaskDone(taskId, 2 * 60 * 1000);

    const vp = path.join(ACCOUNTS_DIR, dirName, "verified-at.json");
    if (fse.existsSync(vp)) {
      const result = JSON.parse(fse.readFileSync(vp, "utf-8"));
      return NextResponse.json({ email, ...result });
    }

    return NextResponse.json({
      email,
      verified: false,
      status: "error",
      detail: "验证完成但未找到结果文件",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "验证失败" }, { status: 500 });
  }
}
