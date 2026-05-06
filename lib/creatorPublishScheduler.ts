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

  const publishCfg = getConfig().creatorPublish || {};
  const publishEnabled = task.payload.publishEnabled ?? publishCfg.publishEnabled ?? true;
  const publishWaitSec = task.payload.publishWaitSec ?? publishCfg.publishWaitSec ?? 3;
  args.push("--publishEnabled", String(publishEnabled));
  args.push("--publishWaitSec", String(publishWaitSec));

  return args;
}

// ========== 进程状态管理（模块级，不依赖磁盘 I/O） ==========

let dispatching = false;
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const SCHEDULER_INTERVAL_MS = 5_000;

/** 内存中正在执行任务的店铺名集合（每次调度从磁盘初始化，派生时即时更新） */
const runningAccountNames = new Set<string>();
/** 内存中当前正在运行的任务总数（从 runningAccountNames.size 计算） */
let inMemoryRunningCount = 0;

function loadRunningStateFromDisk() {
  const tasks = readCreatorPublishTasks();
  runningAccountNames.clear();
  inMemoryRunningCount = 0;
  for (const t of tasks) {
    if (t.status === "running" && t.accountName) {
      runningAccountNames.add(t.accountName);
      inMemoryRunningCount++;
    }
  }
}

function markAccountRunning(accountName: string) {
  runningAccountNames.add(accountName);
  inMemoryRunningCount = runningAccountNames.size;
}

function markAccountDone(accountName: string) {
  // 检查是否还有该账号的其他 running 任务
  const tasks = readCreatorPublishTasks();
  const stillRunning = tasks.some((t) => t.accountName === accountName && t.status === "running");
  if (!stillRunning) {
    runningAccountNames.delete(accountName);
    inMemoryRunningCount = runningAccountNames.size;
  }
}

// ========== 调度主逻辑 ==========

export function runPendingCreatorPublishTasks(): number {
  if (dispatching) return 0;
  dispatching = true;

  try {
    reconcileStaleRunningCreatorPublishTasks();
    loadRunningStateFromDisk();

    const tasks = readCreatorPublishTasks();
    const maxConcurrent = getConcurrencyLimit("creator-publish");
    let started = 0;

    for (const t of tasks) {
      if (t.status !== "pending") continue;

      // 1) 全局并发上限
      if (!canStartTask("creator-publish")) break;

      // 2) 同账号互斥（内存即时判断）
      if (runningAccountNames.has(t.accountName)) continue;

      // 3) 标记账号占位（立即生效，后续同号任务直接跳过）
      markAccountRunning(t.accountName);

      const runtimeTaskId = generateTaskIdWithTime(`creator-publish-${t.id}`);
      patchCreatorPublishTask(t.id, { status: "running", taskId: runtimeTaskId, lastError: undefined });

      try {
        const runtimeHooks = attachCreatorPublishTaskRuntime(runtimeTaskId, {
          onClose: () => {
            markAccountDone(t.accountName);
            runPendingCreatorPublishTasks();
          },
        });
        const { child } = spawnTask(runtimeTaskId, "node", buildRunArgs(t), {
          namespace: "creator-publish",
          cwd: path.resolve(process.cwd()),
          onClose: (_code) => {
            runtimeHooks.onClose?.(_code);
          },
          onError: (err) => {
            markAccountDone(t.accountName);
            runtimeHooks.onError?.(err);
          },
        });
        if (child.pid) {
          patchCreatorPublishTask(t.id, { pid: child.pid });
        }
        started++;
      } catch (e: any) {
        markAccountDone(t.accountName);
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
