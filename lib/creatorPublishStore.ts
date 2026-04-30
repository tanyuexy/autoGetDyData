import fs from "fs";
import path from "path";

export const CREATOR_PUBLISH_TASKS_PATH = path.resolve(
  process.env.CREATOR_PUBLISH_TASKS_PATH ||
    path.join(process.cwd(), "storage/creator-publish/tasks.json")
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
}

export interface CreatorPublishVideoPayload extends CreatorPublishPayloadBase {
  type: "video";
  videoFileKey: string; // points to storage/creator-materials/<key>
}

export interface CreatorPublishArticlePayload extends CreatorPublishPayloadBase {
  type: "article";
  imagesFileKeys: string[]; // points to storage/creator-materials/<key>
  coverImageKey?: string;
  productLink?: string;
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
      patchCreatorPublishTask(target.id, {
        status: code === 0 ? "success" : "failed",
        lastError: code === 0 ? undefined : `退出码 ${code ?? -1}`,
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
