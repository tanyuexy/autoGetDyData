import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { createChannel } from "./sseManager";
import { getConfig } from "./configService";
import {
  getRuntimeProcess,
  getRuntimeProcessesByNamespace,
  isPidAlive,
  readRuntimeProcesses,
  registerRuntimeProcess,
  removeRuntimeProcess,
} from "./runtimeProcessStore";

export type TaskNamespace = "creator-export" | "shop-export" | "creator-publish" | "login" | "system" | "feishu";

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

interface NamespaceState {
  tasks: Map<string, ChildProcess>;
  stoppingTasks: Set<string>;
  maxConcurrent: number;
  taskMeta: Map<string, { startedAt: number; namespace: TaskNamespace }>;
}

const DEFAULT_MAX_CONCURRENT: Record<TaskNamespace, number> = {
  "creator-export": 1,
  "shop-export": 1,
  "creator-publish": 3,
  login: 1,
  system: 1,
  feishu: 1,
};

const DEFAULT_TIMEOUT_MS: Partial<Record<TaskNamespace, number>> = {
  "creator-export": 60 * 60 * 1000,
  "shop-export": 2 * 60 * 60 * 1000,
  "creator-publish": 30 * 60 * 1000,
  login: 30 * 60 * 1000,
  feishu: 30 * 60 * 1000,
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

const TASK_LOGS_DIR = path.resolve(
  process.env.TASK_LOGS_DIR || path.join(process.cwd(), "storage/task-logs")
);

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function safeFileName(name: string) {
  return String(name || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);
}

function getTaskLogPath(taskId: string) {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(TASK_LOGS_DIR, day, `${safeFileName(taskId)}.log`);
}

function appendTaskLog(taskId: string, entry: { level: string; text: string; timestamp: string }) {
  try {
    const filePath = getTaskLogPath(taskId);
    ensureDir(path.dirname(filePath));
    const line = `[${entry.timestamp}] [${String(entry.level).toUpperCase()}] ${entry.text}\n`;
    fs.appendFileSync(filePath, line, "utf-8");
  } catch {
    // ignore file log errors to avoid breaking tasks
  }
}

function countMemoryRunning(ns: NamespaceState): number {
  let running = 0;
  for (const id of ns.tasks.keys()) {
    if (!ns.stoppingTasks.has(id)) running++;
  }
  return running;
}

function countRegistryRunning(namespace: TaskNamespace): number {
  const ns = getOrCreateNamespace(namespace);
  const memoryIds = new Set(ns.tasks.keys());
  let running = countMemoryRunning(ns);
  for (const record of getRuntimeProcessesByNamespace(namespace)) {
    if (!memoryIds.has(record.taskId)) running++;
  }
  return running;
}

/** Check if a namespace can accept a new task */
export function canStartTask(namespace: TaskNamespace): boolean {
  const ns = getOrCreateNamespace(namespace);
  return countRegistryRunning(namespace) < ns.maxConcurrent;
}

/** Get the maxConcurrent limit for a namespace */
export function getConcurrencyLimit(namespace: TaskNamespace): number {
  return getOrCreateNamespace(namespace).maxConcurrent;
}

/** Legacy: check if any task is running (optionally scoped to namespace) */
export function isTaskRunning(namespace?: TaskNamespace): boolean {
  if (namespace) return !canStartTask(namespace);
  for (const nsName of Object.keys(DEFAULT_MAX_CONCURRENT) as TaskNamespace[]) {
    if (countRegistryRunning(nsName) > 0) return true;
  }
  return false;
}

/** Get first running task ID in a namespace (or first globally) */
export function getRunningTaskId(namespace?: TaskNamespace): string | null {
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
    return getRuntimeProcessesByNamespace(namespace)[0]?.taskId || null;
  }
  for (const ns of namespaces.values()) {
    const id = check(ns);
    if (id) return id;
  }
  return readRuntimeProcesses({ pruneDead: true })[0]?.taskId || null;
}

export interface RunningTaskInfo {
  taskId: string;
  namespace: TaskNamespace;
  startedAt: number;
}

/** List all currently running tasks across all namespaces */
export function getRunningTaskList(): RunningTaskInfo[] {
  const result = new Map<string, RunningTaskInfo>();
  for (const [nsName, ns] of namespaces) {
    for (const [taskId, meta] of ns.taskMeta) {
      if (!ns.stoppingTasks.has(taskId) && ns.tasks.has(taskId)) {
        result.set(taskId, { taskId, namespace: nsName, startedAt: meta.startedAt });
      }
    }
  }
  for (const record of readRuntimeProcesses({ pruneDead: true })) {
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
      return;
    } catch {
      // fall back to explicit descendant traversal
    }
  }
  const descendants = await collectDescendantPids(pid).catch(() => []);
  for (const childPid of descendants.reverse()) killPid(childPid, signal);
  killPid(pid, signal);
}

function scheduleForceKill(taskId: string, pid: number, child?: ChildProcess) {
  setTimeout(() => {
    const stillAlive = child ? child.exitCode === null : isPidAlive(pid);
    if (!stillAlive) return;
    appendTaskLog(taskId, {
      text: `任务仍未退出，发送 SIGKILL pid=${pid}`,
      level: "error",
      timestamp: new Date().toISOString(),
    });
    killProcessTree(pid, "SIGKILL").catch(() => {});
  }, 5000).unref?.();
}

export function spawnTask(
  taskId: string,
  command: string,
  args: string[],
  options?: {
    namespace?: TaskNamespace;
    cwd?: string;
    onClose?: (code: number | null) => void;
    onError?: (err: Error) => void;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
    interactive?: boolean;
  }
): { sse: ReturnType<typeof createChannel>; child: ChildProcess } {
  const nsName = options?.namespace || "system";
  const ns = getOrCreateNamespace(nsName);
  const sse = createChannel(taskId);

  let headless = String(process.env.HEADLESS === "true" || process.env.HEADLESS === "1");
  try {
    const cfg = getConfig();
    headless = String(cfg.headless === true);
  } catch { }

  const cwd = options?.cwd || process.cwd();
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, HEADLESS: headless, ...(options?.env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    detached: process.platform !== "win32",
  });

  const startedAt = Date.now();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS[nsName];

  ns.tasks.set(taskId, child);
  ns.stoppingTasks.delete(taskId);
  ns.taskMeta.set(taskId, { startedAt, namespace: nsName });

  if (child.pid) {
    registerRuntimeProcess({
      taskId,
      namespace: nsName,
      pid: child.pid,
      command,
      args,
      cwd,
      startedAt,
      timeoutMs,
      interactive: options?.interactive,
    });
  }

  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs && timeoutMs > 0 && !options?.interactive) {
    timeoutTimer = setTimeout(() => {
      appendTaskLog(taskId, {
        text: `任务运行超过 ${Math.round(timeoutMs / 1000)} 秒，自动终止`,
        level: "error",
        timestamp: new Date().toISOString(),
      });
      killTask(taskId);
    }, timeoutMs);
    timeoutTimer.unref?.();
  }

  let stdoutBuf = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      const ts = new Date().toISOString();
      const entry = { text: trimmed, level: "info", timestamp: ts } as const;
      appendTaskLog(taskId, entry);
      sse.send("log", entry);
    }
  });

  let stderrBuf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      const ts = new Date().toISOString();
      const entry = { text: trimmed, level: "error", timestamp: ts } as const;
      appendTaskLog(taskId, entry);
      sse.send("log", entry);
    }
  });

  function cleanupRuntimeState() {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    ns.stoppingTasks.delete(taskId);
    ns.tasks.delete(taskId);
    ns.taskMeta.delete(taskId);
    removeRuntimeProcess(taskId);
  }

  child.on("close", (code) => {
    if (stdoutBuf.trim()) {
      const ts = new Date().toISOString();
      const entry = { text: stdoutBuf.trimEnd(), level: "info", timestamp: ts } as const;
      appendTaskLog(taskId, entry);
      sse.send("log", entry);
    }
    if (stderrBuf.trim()) {
      const ts = new Date().toISOString();
      const entry = { text: stderrBuf.trimEnd(), level: "error", timestamp: ts } as const;
      appendTaskLog(taskId, entry);
      sse.send("log", entry);
    }
    const doneEvent = {
      code: code ?? -1,
      summary: `Process exited with code ${code ?? -1}`,
    };
    appendTaskLog(taskId, {
      text: `DONE code=${doneEvent.code} summary=${doneEvent.summary}`,
      level: "info",
      timestamp: new Date().toISOString(),
    });
    sse.send("done", doneEvent);
    sse.close();
    cleanupRuntimeState();
    options?.onClose?.(code);
  });

  child.on("error", (err) => {
    const ts = new Date().toISOString();
    const entry = { text: `Process error: ${err.message}`, level: "error", timestamp: ts } as const;
    appendTaskLog(taskId, entry);
    sse.send("log", entry);

    appendTaskLog(taskId, {
      text: `DONE code=-1 summary=${err.message}`,
      level: "info",
      timestamp: new Date().toISOString(),
    });
    sse.send("done", { code: -1, summary: err.message });
    sse.close();
    cleanupRuntimeState();
    options?.onError?.(err);
  });

  return { sse, child };
}

export function killTask(taskId: string): boolean {
  for (const ns of namespaces.values()) {
    const child = ns.tasks.get(taskId);
    if (child?.pid) {
      ns.stoppingTasks.add(taskId);
      appendTaskLog(taskId, {
        text: `正在终止任务进程树 pid=${child.pid}`,
        level: "info",
        timestamp: new Date().toISOString(),
      });
      killProcessTree(child.pid, "SIGTERM").catch(() => child.kill("SIGTERM"));
      scheduleForceKill(taskId, child.pid, child);
      return true;
    }
  }

  const record = getRuntimeProcess(taskId);
  if (!record) return false;
  appendTaskLog(taskId, {
    text: `正在终止已恢复的任务进程树 pid=${record.pid}`,
    level: "info",
    timestamp: new Date().toISOString(),
  });
  killProcessTree(record.pid, "SIGTERM").catch(() => killPid(record.pid, "SIGTERM"));
  scheduleForceKill(taskId, record.pid);
  return true;
}

/** Legacy: list all task IDs across all namespaces */
export function getTaskList(): string[] {
  const ids = new Set<string>();
  for (const ns of namespaces.values()) {
    for (const id of ns.tasks.keys()) ids.add(id);
  }
  for (const record of readRuntimeProcesses({ pruneDead: true })) ids.add(record.taskId);
  return Array.from(ids);
}
