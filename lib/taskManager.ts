import type { ChildProcess } from "child_process";
import { createChannel } from "./sseManager";
import { getConfig } from "./configService";
import { getDb } from "./db/mongo";
import { appendTaskLog, ensureTaskLogMeta, type TaskLogMeta } from "./taskLogStore";
import {
  getRuntimeProcess,
  getRuntimeProcessesByNamespace,
  isPidAlive,
  readRuntimeProcesses,
  registerRuntimeProcess,
  removeRuntimeProcess,
} from "./runtimeProcessStore";
import { cancelApiTask, countRunningApiTasks, getRunningApiTaskList } from "./apiTaskRunner";

export type TaskNamespace = "creator-export" | "creator-open" | "shop-export" | "creator-publish" | "login" | "system" | "feishu" | "review";

/**
 * 生成带时间后缀的 taskId，格式：{prefix}-HH.mm.ss
 * 例如：creator-export-23.45.12
 */
export function generateTaskIdWithTime(prefix: string): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${prefix}-${hh}.${mm}.${ss}`;
}

function extractTaskLogMeta(
  taskId: string,
  namespace: TaskNamespace,
  command: string,
  args: string[],
  env?: Record<string, string | undefined>
): TaskLogMeta {
  const meta: TaskLogMeta = { namespace };
  const normalizedArgs = Array.isArray(args) ? args.map((item) => String(item || "").trim()) : [];
  const action = normalizedArgs[1] || "";

  if (command === "node" && normalizedArgs[0] === "scripts/run.js") {
    if ((action === "creator:open" || action === "creator:login") && normalizedArgs[2]) {
      meta.accountName = normalizedArgs[2];
      meta.target = normalizedArgs[2];
      return meta;
    }

    if (action === "shop:login" && normalizedArgs[2]) {
      meta.target = normalizedArgs[2];
      return meta;
    }
  }

  const shopNames = String(env?.SHOP_SELECTED_NAMES || "").trim();
  if (shopNames) meta.target = shopNames;

  if (!meta.target && taskId) meta.target = taskId;
  return meta;
}

interface NamespaceState {
  tasks: Map<string, ChildProcess>;
  stoppingTasks: Set<string>;
  maxConcurrent: number;
  taskMeta: Map<string, { startedAt: number; namespace: TaskNamespace }>;
}

const DEFAULT_MAX_CONCURRENT: Record<TaskNamespace, number> = {
  "creator-export": 1,
  "creator-open": Number.POSITIVE_INFINITY,
  "shop-export": 1,
  "creator-publish": 3,
  login: 1,
  system: 1,
  feishu: 1,
  review: 1,
};

const DEFAULT_TIMEOUT_MS: Partial<Record<TaskNamespace, number>> = {
  "creator-export": 60 * 60 * 1000,
  "creator-open": 60 * 60 * 1000,
  "shop-export": 2 * 60 * 60 * 1000,
  "creator-publish": 30 * 60 * 1000,
  login: 30 * 60 * 1000,
  feishu: 30 * 60 * 1000,
  review: 30 * 60 * 1000,
};

const namespaces = new Map<TaskNamespace, NamespaceState>();

function getOrCreateNamespace(ns: TaskNamespace): NamespaceState {
  let state = namespaces.get(ns);
  if (!state) {
    state = {
      tasks: new Map(),
      stoppingTasks: new Set(),
      maxConcurrent: DEFAULT_MAX_CONCURRENT[ns] ?? 1,
      taskMeta: new Map(),
    };
    namespaces.set(ns, state);
  }
  return state;
}

function countMemoryRunning(ns: NamespaceState): number {
  let running = 0;
  for (const id of ns.tasks.keys()) {
    if (!ns.stoppingTasks.has(id)) running++;
  }
  return running;
}

async function countRegistryRunning(namespace: TaskNamespace): Promise<number> {
  const ns = getOrCreateNamespace(namespace);
  const memoryIds = new Set(ns.tasks.keys());
  let running = countMemoryRunning(ns) + countRunningApiTasks(namespace);
  for (const record of await getRuntimeProcessesByNamespace(namespace)) {
    if (!memoryIds.has(record.taskId)) running++;
  }
  const db = await getDb();
  running += await db.collection("task_jobs").countDocuments({
    namespace,
    status: "queued",
  });
  if (namespace === "creator-publish") {
    running += await db.collection("creator_publish_tasks").countDocuments({
      status: { $in: ["queued", "running"] },
    });
  }
  return running;
}

/** Check if a namespace can accept a new task */
export async function canStartTask(namespace: TaskNamespace): Promise<boolean> {
  const ns = getOrCreateNamespace(namespace);
  return (await countRegistryRunning(namespace)) < ns.maxConcurrent;
}

/** Get the maxConcurrent limit for a namespace */
export function getConcurrencyLimit(namespace: TaskNamespace): number {
  return getOrCreateNamespace(namespace).maxConcurrent;
}

/** Legacy: check if any task is running (optionally scoped to namespace) */
export async function isTaskRunning(namespace?: TaskNamespace): Promise<boolean> {
  if (namespace) return !(await canStartTask(namespace));
  for (const nsName of Object.keys(DEFAULT_MAX_CONCURRENT) as TaskNamespace[]) {
    if ((await countRegistryRunning(nsName)) > 0) return true;
  }
  return false;
}

/** Get first running task ID in a namespace (or first globally) */
export async function getRunningTaskId(namespace?: TaskNamespace): Promise<string | null> {
  const check = (ns: NamespaceState) => {
    for (const id of ns.tasks.keys()) {
      if (!ns.stoppingTasks.has(id)) return id;
    }
    return null;
  };
  if (namespace) {
    const ns = namespaces.get(namespace);
    const memoryId = ns ? check(ns) : null;
    if (memoryId) return memoryId;
    return (await getRuntimeProcessesByNamespace(namespace))[0]?.taskId || null;
  }
  for (const ns of namespaces.values()) {
    const id = check(ns);
    if (id) return id;
  }
  return (await readRuntimeProcesses({ pruneDead: true }))[0]?.taskId || null;
}

export interface RunningTaskInfo {
  taskId: string;
  namespace: TaskNamespace;
  startedAt: number;
}

/** List all currently running tasks across all namespaces */
export async function getRunningTaskList(): Promise<RunningTaskInfo[]> {
  const result = new Map<string, RunningTaskInfo>();
  for (const record of getRunningApiTaskList()) {
    result.set(record.taskId, record);
  }
  for (const [nsName, ns] of namespaces) {
    for (const [taskId, meta] of ns.taskMeta) {
      if (!ns.stoppingTasks.has(taskId) && ns.tasks.has(taskId)) {
        result.set(taskId, { taskId, namespace: nsName, startedAt: meta.startedAt });
      }
    }
  }
  for (const record of await readRuntimeProcesses({ pruneDead: true })) {
    if (!result.has(record.taskId)) {
      result.set(record.taskId, {
        taskId: record.taskId,
        namespace: record.namespace,
        startedAt: record.startedAt,
      });
    }
  }
  return Array.from(result.values()).sort((a, b) => b.startedAt - a.startedAt);
}

async function collectDescendantPids(pid: number): Promise<number[]> {
  if (process.platform === "win32") return [];
  const { execFile } = await import("child_process");
  return await new Promise((resolve) => {
    execFile("pgrep", ["-P", String(pid)], async (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve([]);
        return;
      }
      const children = stdout
        .split(/\s+/)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
      const nested = await Promise.all(children.map((childPid) => collectDescendantPids(childPid)));
      resolve([...children, ...nested.flat()]);
    });
  });
}

function killPid(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(pid, signal);
  } catch {
    // process may have exited
  }
}

async function killProcessTree(pid: number, signal: NodeJS.Signals) {
  if (!isPidAlive(pid)) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
    } catch {
      // fall back to explicit descendant traversal
    }
  }
}

async function scheduleForceKill(
  taskId: string,
  pid: number,
  child?: ChildProcess,
  descendantPidsBeforeKill?: number[]
) {
  setTimeout(async () => {
    const stillAlive = child ? child.exitCode === null : isPidAlive(pid);
    if (!stillAlive) {
      // root is dead, but descendants may have survived (e.g. Chromium in own process group)
      const survivingDescendants = (descendantPidsBeforeKill || []).filter((p) => isPidAlive(p));
      if (survivingDescendants.length === 0) return;
      appendTaskLog(taskId, {
        text: `根进程已退出，但仍有 ${survivingDescendants.length} 个后代进程存活，发送 SIGKILL`,
        level: "error",
        timestamp: new Date().toISOString(),
      });
      for (const childPid of survivingDescendants.reverse()) killPid(childPid, "SIGKILL");
      return;
    }
    appendTaskLog(taskId, {
      text: `任务仍未退出，发送 SIGKILL pid=${pid}`,
      level: "error",
      timestamp: new Date().toISOString(),
    });
    const descendants = await collectDescendantPids(pid).catch(() => []);
    for (const childPid of descendants.reverse()) killPid(childPid, "SIGKILL");
    killPid(pid, "SIGKILL");
    if (process.platform !== "win32") {
      try { process.kill(-pid, "SIGKILL"); } catch {}
    }
  }, 5000).unref?.();
}

export async function enqueueTask(
  taskId: string,
  command: string,
  args: string[],
  options?: {
    namespace?: TaskNamespace;
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
    interactive?: boolean;
  }
): Promise<{ sse: ReturnType<typeof createChannel> }> {
  const nsName = options?.namespace || "system";
  const sse = createChannel(taskId);

  let headless = String(process.env.HEADLESS === "true" || process.env.HEADLESS === "1");
  try {
    const cfg = await getConfig();
    headless = String(cfg.headless === true);
  } catch { }

  const cwd = options?.cwd || process.cwd();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS[nsName];
  const now = new Date();
  const db = await getDb();
  await db.collection("task_jobs").replaceOne(
    { taskId },
    {
      taskId,
      namespace: nsName,
      status: "queued",
      command,
      args,
      cwd,
      env: { HEADLESS: headless, ...(options?.env || {}) },
      timeoutMs,
      interactive: options?.interactive === true,
      createdAt: now,
      updatedAt: now,
    },
    { upsert: true }
  );

  ensureTaskLogMeta(taskId, extractTaskLogMeta(taskId, nsName, command, args, options?.env), now.toISOString());
  appendTaskLog(taskId, {
    text: `任务已加入队列 namespace=${nsName}`,
    level: "info",
    timestamp: now.toISOString(),
  });

  return { sse };
}

export async function killTask(taskId: string): Promise<boolean> {
  if (cancelApiTask(taskId)) return true;

  for (const ns of namespaces.values()) {
    const child = ns.tasks.get(taskId);
    if (child?.pid) {
      ns.stoppingTasks.add(taskId);
      const descendants = await collectDescendantPids(child.pid).catch(() => []);
      appendTaskLog(taskId, {
        text: `正在终止任务进程树 pid=${child.pid}`,
        level: "info",
        timestamp: new Date().toISOString(),
      });
      killProcessTree(child.pid, "SIGTERM").catch(() => child.kill("SIGTERM"));
      scheduleForceKill(taskId, child.pid, child, descendants);
      return true;
    }
  }

  const record = await getRuntimeProcess(taskId);
  if (!record) {
    const db = await getDb();
    const result = await db.collection("task_jobs").updateOne(
      { taskId, status: "queued" },
      {
        $set: {
          status: "cancelled",
          updatedAt: new Date(),
          lastError: "管理员手动终止",
        },
      }
    );
    return result.modifiedCount > 0;
  }
  const db = await getDb();
  await db.collection("task_jobs").updateOne(
    { taskId },
    {
      $set: {
        status: "cancelled",
        updatedAt: new Date(),
        lastError: "管理员手动终止",
      },
    }
  );
  const descendants = await collectDescendantPids(record.pid).catch(() => []);
  appendTaskLog(taskId, {
    text: `正在终止已恢复的任务进程树 pid=${record.pid}`,
    level: "info",
    timestamp: new Date().toISOString(),
  });
  killProcessTree(record.pid, "SIGTERM").catch(() => killPid(record.pid, "SIGTERM"));
  scheduleForceKill(taskId, record.pid, undefined, descendants);
  return true;
}

/** Legacy: list all task IDs across all namespaces */
export async function getTaskList(): Promise<string[]> {
  const ids = new Set<string>();
  for (const ns of namespaces.values()) {
    for (const id of ns.tasks.keys()) ids.add(id);
  }
  for (const record of await readRuntimeProcesses({ pruneDead: true })) ids.add(record.taskId);
  return Array.from(ids);
}
