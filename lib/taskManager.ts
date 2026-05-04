import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { createChannel } from "./sseManager";
import { getConfig } from "./configService";

export type TaskNamespace = "creator-export" | "shop-export" | "creator-publish" | "login" | "system";

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

/** Check if a namespace can accept a new task */
export function canStartTask(namespace: TaskNamespace): boolean {
  const ns = getOrCreateNamespace(namespace);
  let running = 0;
  for (const id of ns.tasks.keys()) {
    if (!ns.stoppingTasks.has(id)) running++;
  }
  return running < ns.maxConcurrent;
}

/** Legacy: check if any task is running (optionally scoped to namespace) */
export function isTaskRunning(namespace?: TaskNamespace): boolean {
  if (namespace) return !canStartTask(namespace);
  for (const ns of namespaces.values()) {
    for (const id of ns.tasks.keys()) {
      if (!ns.stoppingTasks.has(id)) return true;
    }
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
    return ns ? check(ns) : null;
  }
  for (const ns of namespaces.values()) {
    const id = check(ns);
    if (id) return id;
  }
  return null;
}

export interface RunningTaskInfo {
  taskId: string;
  namespace: TaskNamespace;
  startedAt: number;
}

/** List all currently running tasks across all namespaces */
export function getRunningTaskList(): RunningTaskInfo[] {
  const result: RunningTaskInfo[] = [];
  for (const [nsName, ns] of namespaces) {
    for (const [taskId, meta] of ns.taskMeta) {
      if (!ns.stoppingTasks.has(taskId) && ns.tasks.has(taskId)) {
        result.push({ taskId, namespace: nsName, startedAt: meta.startedAt });
      }
    }
  }
  result.sort((a, b) => b.startedAt - a.startedAt);
  return result;
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

  const child = spawn(command, args, {
    cwd: options?.cwd || process.cwd(),
    env: { ...process.env, HEADLESS: headless, ...(options?.env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    detached: true,
  });

  ns.tasks.set(taskId, child);
  ns.stoppingTasks.delete(taskId);
  ns.taskMeta.set(taskId, { startedAt: Date.now(), namespace: nsName });

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
    ns.stoppingTasks.delete(taskId);
    ns.tasks.delete(taskId);
    const meta = ns.taskMeta.get(taskId);
    ns.taskMeta.delete(taskId);
    recordTaskCompletion(taskId, nsName, meta?.startedAt ?? Date.now(), doneEvent.code, doneEvent.summary);
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
    ns.stoppingTasks.delete(taskId);
    ns.tasks.delete(taskId);
    const eMeta = ns.taskMeta.get(taskId);
    ns.taskMeta.delete(taskId);
    recordTaskCompletion(taskId, nsName, eMeta?.startedAt ?? Date.now(), -1, err.message);
    options?.onError?.(err);
  });

  return { sse, child };
}

export function killTask(taskId: string): boolean {
  for (const ns of namespaces.values()) {
    const child = ns.tasks.get(taskId);
    if (child) {
      ns.stoppingTasks.add(taskId);
      // Kill the process group (detached:true creates a new group where child.pid is leader)
      try { process.kill(-child.pid!, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      setTimeout(() => {
        if (child.exitCode === null) {
          try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        }
      }, 5000);
      return true;
    }
  }
  return false;
}

/** Legacy: list all task IDs across all namespaces */
export function getTaskList(): string[] {
  const ids: string[] = [];
  for (const ns of namespaces.values()) {
    for (const id of ns.tasks.keys()) ids.push(id);
  }
  return ids;
}

// ---- Task completion history ----

const TASK_HISTORY_PATH = path.resolve(process.cwd(), "storage/task-history.json");
const MAX_HISTORY = 50;

export interface CompletedTaskInfo {
  taskId: string;
  namespace: TaskNamespace;
  startedAt: number;
  finishedAt: number;
  exitCode: number | null;
  summary: string;
}

function readTaskHistory(): CompletedTaskInfo[] {
  try {
    if (!fs.existsSync(TASK_HISTORY_PATH)) return [];
    const raw = fs.readFileSync(TASK_HISTORY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeTaskHistory(tasks: CompletedTaskInfo[]) {
  try {
    const dir = path.dirname(TASK_HISTORY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TASK_HISTORY_PATH, JSON.stringify(tasks.slice(0, MAX_HISTORY), null, 2), "utf-8");
  } catch { }
}

function recordTaskCompletion(taskId: string, nsName: TaskNamespace, startedAt: number, exitCode: number | null, summary: string) {
  const history = readTaskHistory();
  history.push({ taskId, namespace: nsName, startedAt, finishedAt: Date.now(), exitCode, summary });
  writeTaskHistory(history);
}

export function getRecentCompletedTasks(): CompletedTaskInfo[] {
  return readTaskHistory();
}

/** List running + recently completed tasks for frontend display */
export function getTaskListWithHistory(): { running: RunningTaskInfo[]; recent: RunningTaskInfo[] } {
  const running = getRunningTaskList();
  const completed = readTaskHistory()
    .filter((t) => Date.now() - t.finishedAt < 30 * 60 * 1000)
    .map((t) => ({
      taskId: t.taskId,
      namespace: t.namespace,
      startedAt: t.startedAt,
    }));
  const runningIds = new Set(running.map((r) => r.taskId));
  const recent = completed.filter((c) => !runningIds.has(c.taskId));
  return { running, recent };
}
