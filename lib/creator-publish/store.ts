import { getTaskList } from "@/lib/tasks/taskManager";
import { getDb } from "@/lib/db/mongo";
import { loadTaskSnapshot, readLastTaskError } from "@/lib/tasks/taskLogStore";
import { loadFeishuBitableConfigForProfile } from "@/lib/feishu/core/config";
import { getValidAccessToken } from "@/lib/feishu/core/oauth";
import {
  updateBitableRecord,
  listAllBitableRecords,
} from "@/lib/feishu/core/bitable";

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

const TASK_TABLE_PATCH_KEYS = new Set<string>([
  "status",
  "lastError",
  "accountName",
  "payload",
  "feishuRowNumber",
]);

export function patchTouchesTaskTable(patch: Partial<CreatorPublishTask>): boolean {
  for (const k of TASK_TABLE_PATCH_KEYS) {
    if (k in patch) return true;
  }
  return false;
}

export interface CreatorPublishTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** 表格可见字段（见 patchTouchesTaskTable）最后变更时间；未迁移的旧任务可回落到 updatedAt */
  displayUpdatedAt?: string;
  accountName: string;
  status: CreatorPublishTaskStatus;
  payload: CreatorPublishPayload;
  lastError?: string;
  failureCategory?: string;
  failureRetryable?: boolean;
  failureSeverity?: string;
  failureReason?: string;
  failedStepIndex?: number;
  failedStepTitle?: string;
  failedStepTag?: string;
  failedStepPhase?: string;
  failedStepStatePath?: string;
  taskId?: string; // runtime task id for SSE
  pid?: number; // 子进程 PID，用于崩溃恢复时检测进程是否仍存活
  feishuRecordId?: string; // 飞书行 record_id，用于发布成功后回写状态
  feishuContentHash?: string; // 飞书内容摘要，用于导入时判断是否需要覆盖本地任务
  feishuRowNumber?: number; // 飞书当前所在行号，刷新任务时会随飞书位置变化更新
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
    .sort({ displayUpdatedAt: -1, updatedAt: -1, createdAt: -1 })
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
  const touchDisplay = patchTouchesTaskTable(patch);
  const nextPatch = {
    ...patch,
    updatedAt,
    ...(touchDisplay ? { displayUpdatedAt: updatedAt } : {}),
  };
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

function formatFeishuFailureStatus(errorText: string | undefined): string {
  const raw = String(errorText || "未知错误");
  return `创建失败: ${raw}`.replace(/\s+/g, " ").trim().slice(0, 200);
}

function isBrowserClosedErrorText(text: string | undefined): boolean {
  return /Target page, context or browser has been closed/i.test(String(text || "").trim());
}

function isManualTerminationText(text: string | undefined): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return (
    raw === "管理员手动终止" ||
    raw === "用户手动终止" ||
    /收到 SIG(?:TERM|INT)/i.test(raw) ||
    /退出码 143\b/i.test(raw) ||
    /Process exited with code 143\b/i.test(raw) ||
    isBrowserClosedErrorText(raw)
  );
}

function normalizeTerminationMessage(text: string | undefined, code?: number | null): string | undefined {
  if (!text && code !== 143) return text;
  if (code === 143 || isManualTerminationText(text)) {
    return "管理员手动终止";
  }
  return text;
}

function isCartLimitErrorText(text: string | undefined): boolean {
  return /购物车限额/.test(String(text || "").trim());
}

function isScheduleTimeErrorText(text: string | undefined): boolean {
  return /定时时间不满足平台要求/.test(String(text || "").trim());
}

function isScheduleToday(scheduleAt: string | null | undefined): boolean {
  if (!scheduleAt) return true;
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()) === fmt.format(new Date(scheduleAt));
}

/** 只有购物车限额（且定时为今天）、定时时间不满足平台要求这两种错误才需要回写飞书 */
function shouldWritebackFeishuFailure(errorText: string | undefined, task?: CreatorPublishTask): boolean {
  const text = String(errorText || "").trim();
  if (isScheduleTimeErrorText(text)) return true;
  if (isCartLimitErrorText(text)) {
    return task ? isScheduleToday(task.payload?.scheduleAt) : true;
  }
  return false;
}

function writeBackFeishuFailure(task: CreatorPublishTask, errorText: string | undefined) {
  if (!task.feishuRecordId) return;
  if (!shouldWritebackFeishuFailure(errorText, task)) {
    console.log(
      `[feishu-writeback] 跳过回写 record ${task.feishuRecordId} (${task.accountName}): 错误类型不需要回写飞书`
    );
    return;
  }
  import("@/lib/feishu/service")
    .then(({ writeFeishuTaskStatus }) =>
      writeFeishuTaskStatus({
        recordId: task.feishuRecordId!,
        statusText: formatFeishuFailureStatus(errorText),
        approvalText: "异常待修改",
      })
    )
    .catch((e) => {
      console.error(
        `[feishu-writeback] 回写失败 record ${task.feishuRecordId} (${task.accountName}): ${e.message || e}`
      );
    });
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
        const lastError = "子进程异常退出（PID 已不存在）";
        await patchCreatorPublishTask(task.id, {
          status: "failed",
          lastError,
        });
        writeBackFeishuFailure(task, lastError);
        continue;
      }
    }

    const snap = loadTaskSnapshot(task.taskId);

    // 只有日志里明确包含 DONE 才做状态修复。
    // 如果日志存在但还没有 DONE，说明可能只是进程仍在执行或 taskManager 运行列表短暂不同步，不能提前标记失败。
    if (!snap.found || !snap.done) continue;

    const ok = snap.exitCode === 0;
    const rawLastError = ok
      ? undefined
      : snap.summary || readLastTaskError(task.taskId) || `退出码 ${snap.exitCode}`;
    const manualTerminated = !ok && (snap.exitCode === 143 || isManualTerminationText(rawLastError));
    const lastError = ok ? undefined : normalizeTerminationMessage(rawLastError, snap.exitCode);
    await patchCreatorPublishTask(task.id, {
      status: ok ? "success" : manualTerminated ? "cancelled" : "failed",
      lastError,
    });
    if (!ok && !manualTerminated) {
      writeBackFeishuFailure(task, lastError);
    }
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
        lastError = normalizeTerminationMessage(
          readLastTaskError(runtimeTaskId) || `退出码 ${code ?? -1}`,
          code
        );
      }
      const manualTerminated = code !== 0 && (code === 143 || isManualTerminationText(lastError));
      await patchCreatorPublishTask(resolvedTarget.id, {
        status: code === 0 ? "success" : manualTerminated ? "cancelled" : "failed",
        lastError,
      });

      // 发布成功 + 来自飞书导入 → 回写飞书行状态
      if (code === 0 && resolvedTarget.feishuRecordId) {
        import("@/lib/feishu/service")
          .then(({ markFeishuTaskPublished }) =>
            markFeishuTaskPublished(resolvedTarget.feishuRecordId!)
          )
          .catch((e) => {
            console.error(
              `[feishu-writeback] 发布成功回写失败 record ${resolvedTarget.feishuRecordId}: ${e.message || e}`
            );
          });
      } else if (code !== 0 && !manualTerminated) {
        writeBackFeishuFailure(resolvedTarget, lastError);
      }

      hooks.onClose?.(code);
    },
    async onError(error: Error) {
      const resolvedTarget = target || (await targetPromise);
      if (!resolvedTarget) {
        hooks.onError?.(error);
        return;
      }
      const normalizedLastError = normalizeTerminationMessage(error.message || String(error));
      const manualTerminated = isManualTerminationText(normalizedLastError);
      await patchCreatorPublishTask(resolvedTarget.id, {
        status: manualTerminated ? "cancelled" : "failed",
        lastError: normalizedLastError,
      });
      if (!manualTerminated) {
        writeBackFeishuFailure(resolvedTarget, normalizedLastError);
      }
      hooks.onError?.(error);
    },
  };
}
