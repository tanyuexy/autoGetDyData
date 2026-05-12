import { appendTaskDone, appendTaskLog, ensureTaskLogMeta, type TaskLogMeta } from "./taskLogStore";
import type { TaskNamespace } from "./taskManager";

type RunningApiTask = {
  taskId: string;
  namespace: TaskNamespace;
  startedAt: number;
  cancelled: boolean;
};

const runningApiTasks = new Map<string, RunningApiTask>();

function normalizeLogArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function writeLog(taskId: string, level: "info" | "warn" | "error", args: unknown[]) {
  const text = args.map(normalizeLogArg).join(" ");
  if (!text.trim()) return;
  appendTaskLog(taskId, {
    level,
    text,
    timestamp: new Date().toISOString(),
  });
}

export function getRunningApiTaskList() {
  return Array.from(runningApiTasks.values())
    .filter((task) => !task.cancelled)
    .map((task) => ({
      taskId: task.taskId,
      namespace: task.namespace,
      startedAt: task.startedAt,
    }));
}

export function countRunningApiTasks(namespace: TaskNamespace): number {
  return getRunningApiTaskList().filter((task) => task.namespace === namespace).length;
}

export function cancelApiTask(taskId: string): boolean {
  const task = runningApiTasks.get(taskId);
  if (!task) return false;
  task.cancelled = true;
  appendTaskLog(taskId, {
    level: "warn",
    text: "API 内部任务已标记为取消；当前步骤结束后任务会停止",
    timestamp: new Date().toISOString(),
  });
  return true;
}

export function isApiTaskCancelled(taskId: string): boolean {
  return runningApiTasks.get(taskId)?.cancelled === true;
}

export function startApiTask(
  taskId: string,
  namespace: TaskNamespace,
  meta: TaskLogMeta,
  fn: (helpers: {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    isCancelled: () => boolean;
  }) => Promise<unknown>
) {
  const startedAt = Date.now();
  runningApiTasks.set(taskId, {
    taskId,
    namespace,
    startedAt,
    cancelled: false,
  });

  ensureTaskLogMeta(taskId, { namespace, ...meta }, new Date(startedAt).toISOString());
  appendTaskLog(taskId, {
    level: "info",
    text: `API 任务已启动 namespace=${namespace}`,
    timestamp: new Date(startedAt).toISOString(),
  });

  setImmediate(async () => {
    const original = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    const helpers = {
      log: (...args: unknown[]) => writeLog(taskId, "info", args),
      warn: (...args: unknown[]) => writeLog(taskId, "warn", args),
      error: (...args: unknown[]) => writeLog(taskId, "error", args),
      isCancelled: () => isApiTaskCancelled(taskId),
    };

    console.log = (...args: unknown[]) => {
      original.log(...args);
      helpers.log(...args);
    };
    console.warn = (...args: unknown[]) => {
      original.warn(...args);
      helpers.warn(...args);
    };
    console.error = (...args: unknown[]) => {
      original.error(...args);
      helpers.error(...args);
    };

    try {
      await fn(helpers);
      const cancelled = isApiTaskCancelled(taskId);
      appendTaskDone(taskId, cancelled ? 143 : 0, cancelled ? "API task cancelled" : "API task completed");
    } catch (error: any) {
      helpers.error(error?.message || error);
      appendTaskDone(taskId, 1, error?.message || "API task failed");
    } finally {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
      runningApiTasks.delete(taskId);
    }
  });
}
