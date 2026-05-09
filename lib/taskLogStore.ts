import type { LogEntry } from "@/types";

const taskLogStore = require("@/scripts/common/task-log-store");

export type TaskLogSnapshot = {
  found: boolean;
  logs: LogEntry[];
  done: boolean;
  exitCode: number | null;
  summary: string;
};

export interface RecentTaskLogMeta {
  taskId: string;
  date: string;
  firstLine: string;
  hasDone: boolean;
  exitCode: number | null;
  namespace: string;
  mtime: number;
}

export type BufferedTaskLogEvent = { event: string; data: string };

export interface TaskLogMeta {
  namespace?: string;
  accountName?: string;
  target?: string;
}

export function appendTaskLog(
  taskId: string,
  entry: { level: string; text: string; timestamp?: string }
): void {
  taskLogStore.appendTaskLog(taskId, entry);
}

export function appendTaskDone(taskId: string, code: number | null, summary?: string): void {
  taskLogStore.appendTaskDone(taskId, code, summary);
}

export function ensureTaskLogMeta(taskId: string, meta: TaskLogMeta, timestamp?: string): void {
  taskLogStore.ensureTaskLogMeta(taskId, meta, timestamp);
}

export function loadTaskLogEvents(taskId: string): BufferedTaskLogEvent[] | null {
  return taskLogStore.loadTaskLogEvents(taskId);
}

export function loadTaskSnapshot(taskId: string): TaskLogSnapshot {
  return taskLogStore.loadTaskSnapshot(taskId);
}

export function listRecentTaskLogs(limit = 10): RecentTaskLogMeta[] {
  return taskLogStore.listRecentTaskLogs(limit);
}

export function readLastTaskError(taskId: string): string | undefined {
  return taskLogStore.readLastTaskError(taskId);
}
