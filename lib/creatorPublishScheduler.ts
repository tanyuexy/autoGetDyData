import path from "path";
import { spawnTask } from "./taskManager";
import {
  attachCreatorPublishTaskRuntime,
  patchCreatorPublishTask,
  readCreatorPublishTasks,
  type CreatorPublishTask,
} from "./creatorPublishStore";

let schedulerStarted = false;

function shouldRun(task: CreatorPublishTask, now: Date): boolean {
  if (task.status !== "pending") return false;
  const scheduleAt = task.payload.scheduleAt;
  if (!scheduleAt) return true;
  const t = new Date(scheduleAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t <= now.getTime();
}

function buildRunArgs(task: CreatorPublishTask): string[] {
  const base = ["scripts/run.js"];
  const cmd = task.payload.type === "video" ? "creator:publish-video" : "creator:publish-article";

  const args: string[] = [cmd, "--account", task.accountName, "--task", task.id];

  if (task.payload.type === "video") {
    args.push("--videoKey", task.payload.videoFileKey);
  } else {
    args.push("--imageKeys", task.payload.imagesFileKeys.join(","));
    if (task.payload.coverImageKey) args.push("--coverImageKey", task.payload.coverImageKey);
    if (task.payload.productLink) args.push("--productLink", task.payload.productLink);
  }

  if (task.payload.title) args.push("--title", task.payload.title);
  if (task.payload.description) args.push("--desc", task.payload.description);
  if (task.payload.scheduleAt) args.push("--scheduleAt", task.payload.scheduleAt);

  return [...base, ...args];
}

export function startCreatorPublishScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setInterval(() => {
    const tasks = readCreatorPublishTasks();
    const now = new Date();

    for (const t of tasks) {
      if (!shouldRun(t, now)) continue;

      const runtimeTaskId = `creator-publish-${t.id}-${Date.now()}`;
      patchCreatorPublishTask(t.id, { status: "running", taskId: runtimeTaskId, lastError: undefined });

      try {
        const runtimeHooks = attachCreatorPublishTaskRuntime(runtimeTaskId, {});
        spawnTask(runtimeTaskId, "node", buildRunArgs(t), {
          cwd: path.resolve(process.cwd()),
          onClose: runtimeHooks.onClose,
          onError: runtimeHooks.onError,
        });
      } catch (e: any) {
        patchCreatorPublishTask(t.id, { status: "failed", lastError: e.message || String(e) });
      }
    }
  }, 2000);
}
