import fs from "fs";
import path from "path";
import { getTaskList } from "./taskManager";
import { loadTaskSnapshotFromDisk } from "./sseManager";

export const CREATOR_PUBLISH_TASKS_PATH = path.resolve(
  process.env.CREATOR_PUBLISH_TASKS_PATH ||
  path.join(process.cwd(), "storage/creator-publish/tasks.json")
);

const TASK_LOGS_DIR = path.resolve(
  process.env.TASK_LOGS_DIR || path.join(process.cwd(), "storage/task-logs")
);

export type CreatorPublishTaskType = "video" | "article";

export type CreatorPublishTaskStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export interface CreatorPublishPayloadBase {
  type: CreatorPublishTaskType;
  title?: string;
  description?: string;
  scheduleAt?: string | null; // ISO string
  productTitle: string; // 商品短标题（必填）
  approvalNumber: string; // 广审批文号（必填，默认：不包含广审内容）
  isAiContent?: boolean; // 是否为AI内容，影响自主声明选项
  productLink?: string; // 商品链接
  publishEnabled?: boolean; // 是否点击发布按钮（默认 true）
  publishWaitSec?: number; // 发布后停留秒数（默认 3）
}

export interface CreatorPublishVideoPayload extends CreatorPublishPayloadBase {
  type: "video";
  videoFileKey: string; // points to storage/creator-materials/<key>
}

export interface CreatorPublishArticlePayload extends CreatorPublishPayloadBase {
  type: "article";
  imagesFileKeys: string[]; // points to storage/creator-materials/<key>
  coverImageKey?: string;
}

export type CreatorPublishPayload =
  | CreatorPublishVideoPayload
  | CreatorPublishArticlePayload;

export interface CreatorPublishTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  accountName: string;
  status: CreatorPublishTaskStatus;
  payload: CreatorPublishPayload;
  lastError?: string;
  taskId?: string; // runtime task id for SSE
}

function ensureDirForFile(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readCreatorPublishTasks(): CreatorPublishTask[] {
  try {
    if (!fs.existsSync(CREATOR_PUBLISH_TASKS_PATH)) return [];
    const raw = fs.readFileSync(CREATOR_PUBLISH_TASKS_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data as CreatorPublishTask[];
  } catch {
    return [];
  }
}

export function writeCreatorPublishTasks(tasks: CreatorPublishTask[]) {
  ensureDirForFile(CREATOR_PUBLISH_TASKS_PATH);
  const tmp = CREATOR_PUBLISH_TASKS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, CREATOR_PUBLISH_TASKS_PATH);
}

export function upsertCreatorPublishTask(task: CreatorPublishTask) {
  const tasks = readCreatorPublishTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) tasks[idx] = task;
  else tasks.unshift(task);
  writeCreatorPublishTasks(tasks);
}

export function patchCreatorPublishTask(
  id: string,
  patch: Partial<CreatorPublishTask>
): CreatorPublishTask | null {
  const tasks = readCreatorPublishTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const next: CreatorPublishTask = {
    ...tasks[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  tasks[idx] = next;
  writeCreatorPublishTasks(tasks);
  return next;
}

/**
 * 子进程已不在 taskManager 中，但 tasks.json 仍为 running 时（进程崩溃、onClose 未执行、热重载丢内存等），
 * 根据磁盘日志把状态补成 success / failed，与命令行/日志文件一致。
 */
export function reconcileStaleRunningCreatorPublishTasks(): void {
  const liveIds = new Set(getTaskList());
  const now = Date.now();
  const MIN_RUNNING_MS = 15_000; // skip tasks running <15s to avoid racing with process spawn

  for (const task of readCreatorPublishTasks()) {
    if (task.status !== "running" || !task.taskId) continue;
    if (liveIds.has(task.taskId)) continue;

    // Grace period: don't reconcile tasks that just started running
    const updatedAt = new Date(task.updatedAt).getTime();
    if (Number.isFinite(updatedAt) && now - updatedAt < MIN_RUNNING_MS) continue;

    const snap = loadTaskSnapshotFromDisk(task.taskId);

    // 只有日志里明确包含 DONE 才做状态修复。
    // 如果日志存在但还没有 DONE，说明可能只是进程仍在执行或 taskManager 运行列表短暂不同步，不能提前标记失败。
    if (!snap.found || !snap.done) continue;

    const ok = snap.exitCode === 0;
    patchCreatorPublishTask(task.id, {
      status: ok ? "success" : "failed",
      lastError: ok
        ? undefined
        : snap.summary || readLastTaskError(task.taskId) || `退出码 ${snap.exitCode}`,
    });
  }
}

function readLastTaskError(taskId: string): string | undefined {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const safeName = String(taskId || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
    const logPath = path.join(TASK_LOGS_DIR, day, `${safeName}.log`);
    if (!fs.existsSync(logPath)) return undefined;
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    // 从后往前找第一个有意义的错误行（跳过堆栈行）
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].match(/\[ERROR\] (.*)/);
      if (!match) continue;
      const text = match[1].trim();
      if (/^\s*at\s/.test(text)) continue; // skip stack trace lines
      return text;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function attachCreatorPublishTaskRuntime(
  runtimeTaskId: string,
  hooks: {
    onClose?: (code: number | null) => void;
    onError?: (error: Error) => void;
  }
) {
  const tasks = readCreatorPublishTasks();
  const target = tasks.find((task) => task.taskId === runtimeTaskId);
  if (!target) return hooks;

  return {
    onClose(code: number | null) {
      let lastError: string | undefined;
      if (code !== 0) {
        lastError = readLastTaskError(runtimeTaskId) || `退出码 ${code ?? -1}`;
      }
      patchCreatorPublishTask(target.id, {
        status: code === 0 ? "success" : "failed",
        lastError,
      });
      hooks.onClose?.(code);
    },
    onError(error: Error) {
      patchCreatorPublishTask(target.id, {
        status: "failed",
        lastError: error.message || String(error),
      });
      hooks.onError?.(error);
    },
  };
}
