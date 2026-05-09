#!/usr/bin/env node

require("dotenv").config();

const path = require("path");
const { spawn } = require("child_process");
const { MongoClient } = require("mongodb");
const { appendTaskDone, appendTaskLog } = require("../common/task-log-store");

const projectRoot = path.resolve(__dirname, "../..");
const WORKER_ID = process.env.WORKER_ID || `task-worker-${process.pid}`;
const POLL_MS = Number(
  process.env.TASK_WORKER_POLL_MS ||
    process.env.CREATOR_PUBLISH_WORKER_POLL_MS ||
    5000
);
const PUBLISH_MAX_CONCURRENT = Number(process.env.CREATOR_PUBLISH_MAX_CONCURRENT || 3);
const PUBLISH_TIMEOUT_MS = Number(process.env.CREATOR_PUBLISH_TIMEOUT_MS || 30 * 60 * 1000);
const DEFAULT_NAMESPACE_LIMITS = {
  "creator-export": 1,
  "creator-open": Number.POSITIVE_INFINITY,
  "shop-export": 1,
  "creator-publish": 3,
  login: 1,
  system: 1,
  feishu: 1,
};

let mongoClient = null;
let mongoDb = null;
let shuttingDown = false;
const children = new Map();

async function getDb() {
  if (mongoDb) return mongoDb;
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }
  mongoClient = new MongoClient(process.env.MONGODB_URI);
  await mongoClient.connect();
  mongoDb = mongoClient.db(process.env.MONGODB_DB || "autoGetDyData");
  await Promise.all([
    mongoDb.collection("creator_publish_tasks").createIndexes([
      { key: { status: 1, updatedAt: -1 }, name: "status_updatedAt" },
      { key: { accountName: 1, status: 1 }, name: "account_status" },
      { key: { taskId: 1 }, name: "taskId_sparse", sparse: true },
    ]),
    mongoDb.collection("runtime_processes").createIndex({ namespace: 1 }, { name: "namespace" }),
    mongoDb.collection("task_jobs").createIndexes([
      { key: { status: 1, namespace: 1, createdAt: 1 }, name: "status_namespace_createdAt" },
      { key: { taskId: 1 }, name: "taskId_unique", unique: true },
      { key: { namespace: 1, status: 1 }, name: "namespace_status" },
    ]),
  ]);
  return mongoDb;
}

async function readQueuedJobs() {
  const db = await getDb();
  return db.collection("task_jobs").find({ status: "queued" }).sort({ createdAt: 1 }).toArray();
}

async function readRunningJobs() {
  const db = await getDb();
  return db.collection("task_jobs").find({ status: "running" }).toArray();
}

async function readJob(taskId) {
  const db = await getDb();
  return db.collection("task_jobs").findOne({ taskId });
}

function buildPatchUpdate(patch, updatedAt) {
  const $set = { updatedAt: new Date() };
  if (updatedAt !== undefined) $set.updatedAt = updatedAt;
  const $unset = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) $unset[key] = "";
    else $set[key] = value;
  }
  return {
    ...(Object.keys($set).length ? { $set } : {}),
    ...(Object.keys($unset).length ? { $unset } : {}),
  };
}

async function patchJob(taskId, patch) {
  const db = await getDb();
  await db.collection("task_jobs").updateOne(
    { taskId },
    buildPatchUpdate(patch, new Date())
  );
}

async function claimJob(job) {
  const db = await getDb();
  const result = await db.collection("task_jobs").updateOne(
    { taskId: job.taskId, status: "queued" },
    {
      $set: {
        status: "running",
        workerId: WORKER_ID,
        startedAt: new Date(),
        updatedAt: new Date(),
      },
      $unset: { lastError: "" },
    }
  );
  return result.modifiedCount === 1;
}

async function readConfig() {
  const db = await getDb();
  return (await db.collection("app_config").findOne({ _id: "default" })) || {};
}

async function readQueuedTasks() {
  const db = await getDb();
  return db
    .collection("creator_publish_tasks")
    .find({ status: "queued" })
    .sort({ createdAt: -1 })
    .toArray();
}

async function readRunningTasks() {
  const db = await getDb();
  return db.collection("creator_publish_tasks").find({ status: "running" }).toArray();
}

async function readTask(id) {
  const db = await getDb();
  return db.collection("creator_publish_tasks").findOne({ id });
}

async function patchTask(id, patch) {
  const db = await getDb();
  await db.collection("creator_publish_tasks").updateOne(
    { id },
    buildPatchUpdate(patch, new Date().toISOString())
  );
}

async function claimTask(task, runtimeTaskId) {
  const now = new Date().toISOString();
  const db = await getDb();
  const result = await db.collection("creator_publish_tasks").updateOne(
    { id: task.id, status: "queued" },
    {
      $set: {
        status: "running",
        taskId: runtimeTaskId,
        workerId: WORKER_ID,
        updatedAt: now,
      },
      $unset: { lastError: "" },
    }
  );
  return result.modifiedCount === 1;
}

async function registerRuntimeProcess(record) {
  const updatedAt = Date.now();
  const db = await getDb();
  await db.collection("runtime_processes").replaceOne(
    { taskId: record.taskId },
    { ...record, _id: record.taskId, updatedAt },
    { upsert: true }
  );
}

async function removeRuntimeProcess(taskId) {
  const db = await getDb();
  await db.collection("runtime_processes").deleteOne({ taskId });
}

function namespaceLimit(namespace) {
  const envKey = `JOB_MAX_${String(namespace || "system").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const fromEnv = Number(process.env[envKey]);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return DEFAULT_NAMESPACE_LIMITS[namespace] || 1;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function generateRuntimeTaskId(taskId) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `creator-publish-${taskId}-${hh}.${mm}.${ss}`;
}

function classifyChildLogLine(line, fallbackLevel) {
  const raw = String(line || "").trimEnd();
  const prefixed = raw.match(/^\[(INFO|WARN|WARNING|ERROR)\]\s*(.*)$/i);
  if (prefixed) {
    const tag = prefixed[1].toLowerCase();
    return {
      level: tag === "error" ? "error" : tag === "info" ? "info" : "warn",
      text: prefixed[2],
    };
  }

  if (
    fallbackLevel === "error" &&
    /(继续依赖导出文件日期校验|日期范围校验未通过|首屏存在范围外日期|未采集到投稿列表文本|^\[migration\])/.test(raw)
  ) {
    return { level: "warn", text: raw };
  }

  return { level: fallbackLevel, text: raw };
}

async function buildRunArgs(task) {
  const cmd = task.payload.type === "video" ? "creator:publish-video" : "creator:publish-article";
  const args = [path.join(projectRoot, "scripts/run.js"), cmd, "--account", task.accountName, "--task", task.id];

  if (task.payload.type === "video") {
    args.push("--videoKey", task.payload.videoFileKey);
  } else {
    args.push("--imageKeys", task.payload.imagesFileKeys.join(","));
    if (task.payload.coverImageKey) args.push("--coverImageKey", task.payload.coverImageKey);
  }

  if (task.payload.productLink) args.push("--productLink", task.payload.productLink);
  if (task.payload.title) args.push("--title", task.payload.title);
  if (task.payload.description) args.push("--desc", task.payload.description);
  if (task.payload.productTitle) args.push("--productTitle", task.payload.productTitle);
  if (task.payload.approvalNumber) args.push("--approvalNumber", task.payload.approvalNumber);
  if (task.payload.isAiContent) args.push("--isAiContent");
  if (task.payload.scheduleAt) args.push("--scheduleAt", task.payload.scheduleAt);

  const publishCfg = (await readConfig()).creatorPublish || {};
  const publishEnabled = task.payload.publishEnabled ?? publishCfg.publishEnabled ?? true;
  const publishWaitSec = task.payload.publishWaitSec ?? publishCfg.publishWaitSec ?? 3;
  args.push("--publishEnabled", String(publishEnabled));
  args.push("--publishWaitSec", String(publishWaitSec));
  return args;
}

async function markFeishuPublished(task) {
  if (!task.feishuRecordId) return;
  const child = spawn(
    process.execPath,
    [
      path.join(projectRoot, "scripts/run.js"),
      "feishu:mark-task-published",
      task.feishuRecordId,
      task.accountName || "",
    ],
    {
      cwd: projectRoot,
      stdio: "ignore",
      detached: true,
      env: { ...process.env },
    }
  );
  child.unref();
}

async function startTask(task) {
  const runtimeTaskId = generateRuntimeTaskId(task.id);
  const claimed = await claimTask(task, runtimeTaskId);
  if (!claimed) return false;

  const args = await buildRunArgs(task);
  appendTaskLog(runtimeTaskId, "info", `worker=${WORKER_ID} starting task=${task.id}`);
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  children.set(runtimeTaskId, child);

  if (child.pid) {
    await patchTask(task.id, { pid: child.pid });
    await registerRuntimeProcess({
      taskId: runtimeTaskId,
      namespace: "creator-publish",
      pid: child.pid,
      command: process.execPath,
      args,
      cwd: projectRoot,
      startedAt: Date.now(),
      timeoutMs: PUBLISH_TIMEOUT_MS,
      interactive: false,
    });
  }

  let stdoutBuf = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed) {
        const entry = classifyChildLogLine(trimmed, "info");
        appendTaskLog(runtimeTaskId, entry.level, entry.text);
      }
    }
  });

  let stderrBuf = "";
  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed) {
        const entry = classifyChildLogLine(trimmed, "error");
        appendTaskLog(runtimeTaskId, entry.level, entry.text);
      }
    }
  });

  const timeout = setTimeout(() => {
    appendTaskLog(runtimeTaskId, "error", `任务运行超过 ${Math.round(PUBLISH_TIMEOUT_MS / 1000)} 秒，自动终止`);
    try {
      if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {}
  }, PUBLISH_TIMEOUT_MS);
  timeout.unref?.();

  child.on("close", async (code) => {
    clearTimeout(timeout);
    children.delete(runtimeTaskId);
    if (stdoutBuf.trim()) {
      const entry = classifyChildLogLine(stdoutBuf.trimEnd(), "info");
      appendTaskLog(runtimeTaskId, entry.level, entry.text);
    }
    if (stderrBuf.trim()) {
      const entry = classifyChildLogLine(stderrBuf.trimEnd(), "error");
      appendTaskLog(runtimeTaskId, entry.level, entry.text);
    }

    const ok = code === 0;
    appendTaskDone(runtimeTaskId, code ?? -1, `Process exited with code ${code ?? -1}`);
    const latest = await readTask(task.id);
    if (latest?.status !== "cancelled") {
      await patchTask(task.id, {
        status: ok ? "success" : "failed",
        lastError: ok ? undefined : `退出码 ${code ?? -1}`,
      });
    }
    await removeRuntimeProcess(runtimeTaskId);
    if (ok && latest?.status !== "cancelled") await markFeishuPublished(task);
  });

  child.on("error", async (error) => {
    clearTimeout(timeout);
    children.delete(runtimeTaskId);
    appendTaskLog(runtimeTaskId, "error", `Process error: ${error.message}`);
    appendTaskDone(runtimeTaskId, -1, error.message);
    const latest = await readTask(task.id);
    if (latest?.status !== "cancelled") {
      await patchTask(task.id, { status: "failed", lastError: error.message });
    }
    await removeRuntimeProcess(runtimeTaskId);
  });

  return true;
}

async function startJob(job) {
  const claimed = await claimJob(job);
  if (!claimed) return false;

  appendTaskLog(job.taskId, "info", `worker=${WORKER_ID} starting job namespace=${job.namespace}`);
  const command = job.command === "node" ? process.execPath : job.command;
  const child = spawn(command, Array.isArray(job.args) ? job.args : [], {
    cwd: job.cwd || projectRoot,
    env: { ...process.env, ...(job.env || {}) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  children.set(job.taskId, child);

  if (child.pid) {
    await patchJob(job.taskId, { pid: child.pid });
    await registerRuntimeProcess({
      taskId: job.taskId,
      namespace: job.namespace || "system",
      pid: child.pid,
      command,
      args: Array.isArray(job.args) ? job.args : [],
      cwd: job.cwd || projectRoot,
      startedAt: Date.now(),
      timeoutMs: job.timeoutMs,
      interactive: job.interactive === true,
    });
  }

  let stdoutBuf = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed) {
        const entry = classifyChildLogLine(trimmed, "info");
        appendTaskLog(job.taskId, entry.level, entry.text);
      }
    }
  });

  let stderrBuf = "";
  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed) {
        const entry = classifyChildLogLine(trimmed, "error");
        appendTaskLog(job.taskId, entry.level, entry.text);
      }
    }
  });

  let timeout = null;
  if (job.timeoutMs && job.timeoutMs > 0 && !job.interactive) {
    timeout = setTimeout(() => {
      appendTaskLog(job.taskId, "error", `任务运行超过 ${Math.round(job.timeoutMs / 1000)} 秒，自动终止`);
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {}
    }, job.timeoutMs);
    timeout.unref?.();
  }

  child.on("close", async (code) => {
    if (timeout) clearTimeout(timeout);
    children.delete(job.taskId);
    if (stdoutBuf.trim()) {
      const entry = classifyChildLogLine(stdoutBuf.trimEnd(), "info");
      appendTaskLog(job.taskId, entry.level, entry.text);
    }
    if (stderrBuf.trim()) {
      const entry = classifyChildLogLine(stderrBuf.trimEnd(), "error");
      appendTaskLog(job.taskId, entry.level, entry.text);
    }

    const ok = code === 0;
    appendTaskDone(job.taskId, code ?? -1, `Process exited with code ${code ?? -1}`);
    const latest = await readJob(job.taskId);
    if (latest?.status !== "cancelled") {
      await patchJob(job.taskId, {
        status: ok ? "success" : "failed",
        finishedAt: new Date(),
        exitCode: code ?? -1,
        lastError: ok ? undefined : `退出码 ${code ?? -1}`,
      });
    }
    await removeRuntimeProcess(job.taskId);
  });

  child.on("error", async (error) => {
    if (timeout) clearTimeout(timeout);
    children.delete(job.taskId);
    appendTaskLog(job.taskId, "error", `Process error: ${error.message}`);
    appendTaskDone(job.taskId, -1, error.message);
    const latest = await readJob(job.taskId);
    if (latest?.status !== "cancelled") {
      await patchJob(job.taskId, {
        status: "failed",
        finishedAt: new Date(),
        exitCode: -1,
        lastError: error.message,
      });
    }
    await removeRuntimeProcess(job.taskId);
  });

  return true;
}

async function reconcileStaleRunningTasks() {
  const running = await readRunningTasks();
  for (const task of running) {
    if (task.pid && isPidAlive(task.pid)) continue;
    if (task.workerId && task.workerId !== WORKER_ID && !task.pid) continue;
    await patchTask(task.id, {
      status: "failed",
      lastError: task.pid ? "子进程异常退出（PID 已不存在）" : "Worker 重启后发现未绑定运行进程",
    });
  }
}

async function reconcileStaleJobs() {
  const running = await readRunningJobs();
  for (const job of running) {
    if (job.pid && isPidAlive(job.pid)) continue;
    if (job.workerId && job.workerId !== WORKER_ID && !job.pid) continue;
    await patchJob(job.taskId, {
      status: "failed",
      finishedAt: new Date(),
      exitCode: -1,
      lastError: job.pid ? "子进程异常退出（PID 已不存在）" : "Worker 重启后发现未绑定运行进程",
    });
    await removeRuntimeProcess(job.taskId);
  }
}

async function processQueuedJobs() {
  await reconcileStaleJobs();
  const running = await readRunningJobs();
  const runningByNamespace = new Map();
  for (const job of running) {
    const ns = job.namespace || "system";
    runningByNamespace.set(ns, (runningByNamespace.get(ns) || 0) + 1);
  }

  const queued = await readQueuedJobs();
  for (const job of queued) {
    const ns = job.namespace || "system";
    const used = runningByNamespace.get(ns) || 0;
    if (used >= namespaceLimit(ns)) continue;
    const started = await startJob(job);
    if (!started) continue;
    runningByNamespace.set(ns, used + 1);
  }
}

async function tick() {
  await processQueuedJobs();
  await reconcileStaleRunningTasks();

  const running = await readRunningTasks();
  const runningJobs = await readRunningJobs();
  const runningPublishJobs = runningJobs.filter((job) => job.namespace === "creator-publish").length;
  const runningAccounts = new Set(running.map((task) => task.accountName).filter(Boolean));
  let available = Math.max(0, PUBLISH_MAX_CONCURRENT - running.length - runningPublishJobs);
  if (available <= 0) return;

  const queued = await readQueuedTasks();
  for (const task of queued) {
    if (available <= 0) break;
    if (!task.accountName || runningAccounts.has(task.accountName)) continue;
    const started = await startTask(task);
    if (!started) continue;
    runningAccounts.add(task.accountName);
    available--;
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[task-worker] received ${signal}, stopping ${children.size} child process(es)...`);
  for (const child of children.values()) {
    try {
      if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {}
  }
  if (mongoClient) await mongoClient.close().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

async function main() {
  console.log(`[task-worker] started workerId=${WORKER_ID} driver=mongo`);
  while (!shuttingDown) {
    try {
      await tick();
    } catch (error) {
      console.error("[task-worker] tick failed:", error.message || error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error("[task-worker] fatal:", error);
  process.exit(1);
});
