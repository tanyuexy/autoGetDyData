import path from "path";
import { spawnTask, canStartTask, generateTaskIdWithTime, getConcurrencyLimit } from "./taskManager";
import { getConfig } from "./configService";
import {
  attachCreatorPublishTaskRuntime,
  patchCreatorPublishTask,
  readCreatorPublishTasks,
  reconcileStaleRunningCreatorPublishTasks,
  type CreatorPublishTask,
} from "./creatorPublishStore";

function buildRunArgs(task: CreatorPublishTask): string[] {
  const scriptPath = "scripts/douyin-creator/index.js";
  const cmd = task.payload.type === "video" ? "publish-video" : "publish-article";

  const args: string[] = [scriptPath, cmd, "--account", task.accountName, "--task", task.id];

  if (task.payload.type === "video") {
    args.push("--videoKey", task.payload.videoFileKey);
  } else {
    args.push("--imageKeys", task.payload.imagesFileKeys.join(","));
    if (task.payload.coverImageKey) args.push("--coverImageKey", task.payload.coverImageKey);
  }

  if (task.payload.productLink) args.push("--productLink", task.payload.productLink);
  if (task.payload.title) args.push("--title", task.payload.title);
  if (task.payload.description) args.push("--desc", task.payload.description);
  if (task.payload.productTitle) args.push("--productTitle", task.payload.productTitle);
  if (task.payload.approvalNumber) args.push("--approvalNumber", task.payload.approvalNumber);
  if (task.payload.isAiContent) args.push("--isAiContent");
  if (task.payload.scheduleAt) args.push("--scheduleAt", task.payload.scheduleAt);

  // 发布设置：task payload 可覆盖全局 config
  const publishCfg = getConfig().creatorPublish || {};
  const publishEnabled = task.payload.publishEnabled ?? publishCfg.publishEnabled ?? true;
  const publishWaitSec = task.payload.publishWaitSec ?? publishCfg.publishWaitSec ?? 3;
  args.push("--publishEnabled", String(publishEnabled));
  args.push("--publishWaitSec", String(publishWaitSec));

  return args;
}

let dispatching = false;
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const SCHEDULER_INTERVAL_MS = 5_000;

function countRunningTasksOnDisk(): number {
  const tasks = readCreatorPublishTasks();
  return tasks.filter((t) => t.status === "running").length;
}

export function runPendingCreatorPublishTasks(): number {
  if (dispatching) return 0;
  dispatching = true;

  try {
    reconcileStaleRunningCreatorPublishTasks();

    const tasks = readCreatorPublishTasks();
    const maxConcurrent = getConcurrencyLimit("creator-publish");
    let started = 0;

    for (const t of tasks) {
      if (t.status !== "pending") continue;

      if (!canStartTask("creator-publish")) break;

      if (countRunningTasksOnDisk() >= maxConcurrent) break;

      const runtimeTaskId = generateTaskIdWithTime(`creator-publish-${t.id}`);
      patchCreatorPublishTask(t.id, { status: "running", taskId: runtimeTaskId, lastError: undefined });

      try {
        const runtimeHooks = attachCreatorPublishTaskRuntime(runtimeTaskId, {
          onClose: () => {
            runPendingCreatorPublishTasks();
          },
        });
        const { child } = spawnTask(runtimeTaskId, "node", buildRunArgs(t), {
          namespace: "creator-publish",
          cwd: path.resolve(process.cwd()),
          onClose: runtimeHooks.onClose,
          onError: runtimeHooks.onError,
        });
        if (child.pid) {
          patchCreatorPublishTask(t.id, { pid: child.pid });
        }
        started++;
      } catch (e: any) {
        patchCreatorPublishTask(t.id, { status: "failed", lastError: e.message || String(e) });
      }
    }

    return started;
  } finally {
    dispatching = false;
  }
}

export function startCreatorPublishScheduler(): void {
  if (schedulerInterval) return;
  runPendingCreatorPublishTasks();
  schedulerInterval = setInterval(() => {
    runPendingCreatorPublishTasks();
  }, SCHEDULER_INTERVAL_MS);
}

export function stopCreatorPublishScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
