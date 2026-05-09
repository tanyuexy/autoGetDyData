import path from "path";
import { spawn as spawnChild } from "child_process";
import { getTaskList } from "./taskManager";
import { getDb } from "./db/mongo";
import { loadTaskSnapshot, readLastTaskError } from "./taskLogStore";

export type CreatorPublishTaskType = "video" | "article";

export type CreatorPublishTaskStatus =
  | "pending"
  | "queued"
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
  pid?: number; // 子进程 PID，用于崩溃恢复时检测进程是否仍存活
  feishuRecordId?: string; // 飞书行 record_id，用于发布成功后回写状态
}

function normalizeTask(item: any): CreatorPublishTask | null {
  if (!item || typeof item.id !== "string") return null;
  return item as CreatorPublishTask;
}

export async function readCreatorPublishTasks(): Promise<CreatorPublishTask[]> {
  const db = await getDb();
  const docs = await db
    .collection("creator_publish_tasks")
    .find({})
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(normalizeTask).filter(Boolean) as CreatorPublishTask[];
}

export async function writeCreatorPublishTasks(tasks: CreatorPublishTask[]): Promise<void> {
  const db = await getDb();
  const collection = db.collection("creator_publish_tasks");
  const ids = tasks.map((task) => task.id);
  if (ids.length > 0) {
    await collection.bulkWrite(
      tasks.map((task) => ({
        replaceOne: {
          filter: { id: task.id },
          replacement: { ...task, _id: task.id },
          upsert: true,
        },
      }))
    );
  }
  await collection.deleteMany({ id: { $nin: ids } });
}

export async function upsertCreatorPublishTask(task: CreatorPublishTask): Promise<void> {
  const db = await getDb();
  await db
    .collection("creator_publish_tasks")
    .replaceOne({ id: task.id }, { ...task, _id: task.id }, { upsert: true });
}

export async function patchCreatorPublishTask(
  id: string,
  patch: Partial<CreatorPublishTask>
): Promise<CreatorPublishTask | null> {
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  const nextPatch = { ...patch, updatedAt };
  await db.collection("creator_publish_tasks").updateOne(
    { id },
    {
      $set: Object.fromEntries(
        Object.entries(nextPatch).filter(([, value]) => value !== undefined)
      ),
      $unset: Object.fromEntries(
        Object.entries(nextPatch)
          .filter(([, value]) => value === undefined)
          .map(([key]) => [key, ""])
      ),
    }
  );
  const doc = await db.collection("creator_publish_tasks").findOne({ id });
  return normalizeTask(doc);
}

/**
 * 飞书状态回写 reconciliation — 启动时兜底修复。
 * 读取本地 status=success 且有 feishuRecordId 的任务，对比飞书表「已创建任务」字段，
 * 如果飞书中尚未标记为「是」，则补写回。
 */
export async function reconcileFeishuWritebacks(): Promise<void> {
  const tasks = await readCreatorPublishTasks();
  const pending = tasks.filter(
    (t) => t.status === "success" && t.feishuRecordId
  );
  if (pending.length === 0) return;

  try {
    const { loadFeishuBitableConfigForProfile } = require(
      "../scripts/feishu/lib/config"
    );
    const { getValidAccessToken } = require("../scripts/feishu/lib/oauth");
    const { updateBitableRecord, listAllBitableRecords } = require(
      "../scripts/feishu/lib/bitable"
    );

    const cfg = loadFeishuBitableConfigForProfile("task");
    const tokenCache = await getValidAccessToken(cfg);

    // 读取飞书表所有记录（只需「已创建任务」字段）
    const records = await listAllBitableRecords(
      cfg,
      tokenCache.accessToken,
      "",
      ["已创建任务"]
    );

    // 构建 record_id → 已创建任务 的查找 map
    const feishuStatusMap = new Map<string, string>();
    for (const r of records) {
      if (r.record_id && r.fields) {
        feishuStatusMap.set(r.record_id, r.fields["已创建任务"] || "");
      }
    }

    let written = 0;
    for (const task of pending) {
      const feishuStatus = feishuStatusMap.get(task.feishuRecordId!) || "";
      if (feishuStatus === "是") continue;

      try {
        await updateBitableRecord(cfg, tokenCache.accessToken, task.feishuRecordId!, {
          已创建任务: "是",
        });
        written++;
        console.log(
          `[reconcile-feishu] ✓ 补回写 record ${task.feishuRecordId} (${task.accountName})`
        );
      } catch (e: any) {
        console.error(
          `[reconcile-feishu] ✗ 回写失败 record ${task.feishuRecordId} (${task.accountName}): ${e.message}`
        );
      }
    }

    if (written > 0) {
      console.log(`[reconcile-feishu] 补回写完成: ${written}/${pending.length}`);
    }
  } catch (e: any) {
    console.error("[reconcile-feishu] reconciliation 失败:", e.message);
  }
}

/**
 * 子进程已不在 taskManager 中，但 tasks.json 仍为 running 时（进程崩溃、onClose 未执行、热重载丢内存等），
 * 根据磁盘日志把状态补成 success / failed，与命令行/日志文件一致。
 *
 * 热重载场景：如果 PID 仍存活说明进程还在运行，不处理；PID 已死且日志无DONE则标记失败。
 */
export async function reconcileStaleRunningCreatorPublishTasks(): Promise<void> {
  const liveIds = new Set(await getTaskList());
  const now = Date.now();
  const MIN_RUNNING_MS = 15_000; // skip tasks running <15s to avoid racing with process spawn

  for (const task of await readCreatorPublishTasks()) {
    if (task.status !== "running" || !task.taskId) continue;
    if (liveIds.has(task.taskId)) continue;

    // Grace period: don't reconcile tasks that just started running
    const updatedAt = new Date(task.updatedAt).getTime();
    if (Number.isFinite(updatedAt) && now - updatedAt < MIN_RUNNING_MS) continue;

    // PID 存活性检查：进程还在跑则不处理
    if (task.pid != null) {
      try {
        process.kill(task.pid, 0);
        // PID 存活，进程还在运行（热重载场景），保持 running 不处理
        continue;
      } catch {
        // PID 已死，进程已退出但 onClose 未执行（崩溃/孤儿）
        await patchCreatorPublishTask(task.id, {
          status: "failed",
          lastError: "子进程异常退出（PID 已不存在）",
        });
        continue;
      }
    }

    const snap = loadTaskSnapshot(task.taskId);

    // 只有日志里明确包含 DONE 才做状态修复。
    // 如果日志存在但还没有 DONE，说明可能只是进程仍在执行或 taskManager 运行列表短暂不同步，不能提前标记失败。
    if (!snap.found || !snap.done) continue;

    const ok = snap.exitCode === 0;
    await patchCreatorPublishTask(task.id, {
      status: ok ? "success" : "failed",
      lastError: ok
        ? undefined
        : snap.summary || readLastTaskError(task.taskId) || `退出码 ${snap.exitCode}`,
    });
  }
}

export function attachCreatorPublishTaskRuntime(
  runtimeTaskId: string,
  hooks: {
    onClose?: (code: number | null) => void;
    onError?: (error: Error) => void;
  }
) {
  let target: CreatorPublishTask | null = null;
  const targetPromise = readCreatorPublishTasks().then((tasks) => {
    target = tasks.find((task) => task.taskId === runtimeTaskId) || null;
    return target;
  });

  return {
    async onClose(code: number | null) {
      const resolvedTarget = target || (await targetPromise);
      if (!resolvedTarget) {
        hooks.onClose?.(code);
        return;
      }
      let lastError: string | undefined;
      if (code !== 0) {
        lastError = readLastTaskError(runtimeTaskId) || `退出码 ${code ?? -1}`;
      }
      await patchCreatorPublishTask(resolvedTarget.id, {
        status: code === 0 ? "success" : "failed",
        lastError,
      });

      // 发布成功 + 来自飞书导入 → 回写飞书行状态
      if (code === 0 && resolvedTarget.feishuRecordId) {
        try {
          spawnChild(
            process.execPath,
            [
              path.join(process.cwd(), "scripts/run.js"),
              "feishu:mark-task-published",
              resolvedTarget.feishuRecordId,
              resolvedTarget.accountName || "",
            ],
            { stdio: "inherit", detached: true }
          ).unref();
        } catch { }
      }

      hooks.onClose?.(code);
    },
    async onError(error: Error) {
      const resolvedTarget = target || (await targetPromise);
      if (!resolvedTarget) {
        hooks.onError?.(error);
        return;
      }
      await patchCreatorPublishTask(resolvedTarget.id, {
        status: "failed",
        lastError: error.message || String(error),
      });
      hooks.onError?.(error);
    },
  };
}
