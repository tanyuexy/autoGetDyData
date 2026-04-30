import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { createChannel } from "./sseManager";
import { getConfig } from "./configService";

const tasks = new Map<string, ChildProcess>();
const stoppingTasks = new Set<string>();

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


export function isTaskRunning(): boolean {
  for (const taskId of tasks.keys()) {
    if (!stoppingTasks.has(taskId)) return true;
  }
  return false;
}

export function getRunningTaskId(): string | null {
  const first = tasks.keys().next();
  return first.done ? null : first.value;
}

export function spawnTask(
  taskId: string,
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    onClose?: (code: number | null) => void;
    onError?: (err: Error) => void;
    env?: Record<string, string | undefined>;
  }
): { sse: ReturnType<typeof createChannel>; child: ChildProcess } {
  const sse = createChannel(taskId);

  let headless = String(process.env.HEADLESS === "true" || process.env.HEADLESS === "1");
  try {
    const cfg = getConfig();
    headless = String(cfg.headless === true);
  } catch {}

  const child = spawn(command, args, {
    cwd: options?.cwd || process.cwd(),
    env: { ...process.env, HEADLESS: headless, ...(options?.env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });

  tasks.set(taskId, child);
  stoppingTasks.delete(taskId);

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
    stoppingTasks.delete(taskId);
    tasks.delete(taskId);
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
    stoppingTasks.delete(taskId);
    tasks.delete(taskId);
    options?.onError?.(err);
  });

  return { sse, child };
}

export function killTask(taskId: string): boolean {
  const child = tasks.get(taskId);
  if (!child) return false;
  stoppingTasks.add(taskId);
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 5000);
  return true;
}

export function getTaskList(): string[] {
  return Array.from(tasks.keys());
}
