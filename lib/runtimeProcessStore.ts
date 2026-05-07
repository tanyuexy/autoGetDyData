import fs from "fs";
import path from "path";
import type { TaskNamespace } from "./taskManager";

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

const RUNTIME_DIR = path.resolve(process.env.RUNTIME_DIR || path.join(process.cwd(), "storage/runtime"));
const PROCESS_REGISTRY_PATH = path.resolve(
  process.env.PROCESS_REGISTRY_PATH || path.join(RUNTIME_DIR, "processes.json")
);

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readRegistryFile(): RuntimeProcessRecord[] {
  try {
    if (!fs.existsSync(PROCESS_REGISTRY_PATH)) return [];
    const raw = fs.readFileSync(PROCESS_REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RuntimeProcessRecord => {
      return Boolean(
        item &&
          typeof item.taskId === "string" &&
          typeof item.namespace === "string" &&
          typeof item.pid === "number" &&
          Number.isInteger(item.pid) &&
          item.pid > 0
      );
    });
  } catch {
    return [];
  }
}

function writeRegistryFile(records: RuntimeProcessRecord[]) {
  ensureDir(path.dirname(PROCESS_REGISTRY_PATH));
  const tmp = `${PROCESS_REGISTRY_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, PROCESS_REGISTRY_PATH);
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

export function readRuntimeProcesses(options?: { pruneDead?: boolean }): RuntimeProcessRecord[] {
  const records = readRegistryFile();
  if (!options?.pruneDead) return records;
  const alive = records.filter((record) => isPidAlive(record.pid));
  if (alive.length !== records.length) writeRegistryFile(alive);
  return alive;
}

export function registerRuntimeProcess(record: Omit<RuntimeProcessRecord, "updatedAt">) {
  const now = Date.now();
  const records = readRuntimeProcesses({ pruneDead: true }).filter((item) => item.taskId !== record.taskId);
  records.push({ ...record, updatedAt: now });
  writeRegistryFile(records);
}

export function removeRuntimeProcess(taskId: string) {
  const records = readRegistryFile();
  const next = records.filter((item) => item.taskId !== taskId);
  if (next.length !== records.length) writeRegistryFile(next);
}

export function getRuntimeProcess(taskId: string): RuntimeProcessRecord | null {
  const record = readRuntimeProcesses({ pruneDead: true }).find((item) => item.taskId === taskId);
  return record || null;
}

export function getRuntimeProcessesByNamespace(namespace: TaskNamespace): RuntimeProcessRecord[] {
  return readRuntimeProcesses({ pruneDead: true }).filter((item) => item.namespace === namespace);
}

export function getRuntimeProcessTaskIds(): string[] {
  return readRuntimeProcesses({ pruneDead: true }).map((item) => item.taskId);
}

export function reconcileRuntimeProcesses(): RuntimeProcessRecord[] {
  return readRuntimeProcesses({ pruneDead: true });
}
