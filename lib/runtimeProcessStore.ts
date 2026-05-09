import type { TaskNamespace } from "./taskManager";
import { getDb } from "./db/mongo";

export interface RuntimeProcessRecord {
  taskId: string;
  namespace: TaskNamespace;
  pid: number;
  command: string;
  args: string[];
  cwd: string;
  startedAt: number;
  updatedAt: number;
  timeoutMs?: number;
  interactive?: boolean;
}

function normalizeRecord(item: any): RuntimeProcessRecord | null {
  if (!item || typeof item.taskId !== "string") return null;
  if (typeof item.namespace !== "string") return null;
  if (!Number.isInteger(item.pid) || item.pid <= 0) return null;
  return {
    taskId: item.taskId,
    namespace: item.namespace,
    pid: item.pid,
    command: String(item.command || ""),
    args: Array.isArray(item.args) ? item.args.map(String) : [],
    cwd: String(item.cwd || process.cwd()),
    startedAt: Number(item.startedAt || Date.now()),
    updatedAt: Number(item.updatedAt || Date.now()),
    timeoutMs: item.timeoutMs,
    interactive: item.interactive,
  };
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readRuntimeProcesses(options?: { pruneDead?: boolean }): Promise<RuntimeProcessRecord[]> {
  const db = await getDb();
  const docs = await db.collection("runtime_processes").find({}).toArray();
  const records = docs.map(normalizeRecord).filter(Boolean) as RuntimeProcessRecord[];
  if (!options?.pruneDead) return records;

  const alive = records.filter((record) => isPidAlive(record.pid));
  const dead = records.filter((record) => !isPidAlive(record.pid)).map((record) => record.taskId);
  if (dead.length > 0) {
    await db.collection("runtime_processes").deleteMany({ taskId: { $in: dead } });
  }
  return alive;
}

export async function registerRuntimeProcess(record: Omit<RuntimeProcessRecord, "updatedAt">): Promise<void> {
  const now = Date.now();
  const db = await getDb();
  await db.collection("runtime_processes").replaceOne(
    { taskId: record.taskId },
    { ...record, _id: record.taskId, updatedAt: now },
    { upsert: true }
  );
}

export async function removeRuntimeProcess(taskId: string): Promise<void> {
  const db = await getDb();
  await db.collection("runtime_processes").deleteOne({ taskId });
}

export async function getRuntimeProcess(taskId: string): Promise<RuntimeProcessRecord | null> {
  const record = (await readRuntimeProcesses({ pruneDead: true })).find((item) => item.taskId === taskId);
  return record || null;
}

export async function getRuntimeProcessesByNamespace(namespace: TaskNamespace): Promise<RuntimeProcessRecord[]> {
  return (await readRuntimeProcesses({ pruneDead: true })).filter((item) => item.namespace === namespace);
}

export async function getRuntimeProcessTaskIds(): Promise<string[]> {
  return (await readRuntimeProcesses({ pruneDead: true })).map((item) => item.taskId);
}

export async function reconcileRuntimeProcesses(): Promise<RuntimeProcessRecord[]> {
  return readRuntimeProcesses({ pruneDead: true });
}
