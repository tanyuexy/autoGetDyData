import type { PublishTask, TaskStatus, TaskType } from "@/lib/creator-publish/types";

export const TASK_TYPE_OPTIONS: { label: string; value: TaskType }[] = [
  { label: "视频", value: "video" },
  { label: "图文", value: "article" },
];

export const TERMINABLE_TASK_STATUSES = new Set<TaskStatus>(["queued", "running"]);

/** 表格「操作」列：link 按钮默认 padding 较大，收一点横向间距 */
export const TASK_TABLE_OP_LINK_STYLE = { paddingInline: 1 } as const;

export const STATUS_MAP: Record<TaskStatus, { color: string; text: string }> = {
  pending: { color: "default", text: "待执行" },
  queued: { color: "blue", text: "队列中" },
  running: { color: "processing", text: "执行中" },
  success: { color: "success", text: "成功" },
  failed: { color: "error", text: "失败" },
  cancelled: { color: "warning", text: "已取消" },
};

export const TASK_STATUS_ORDER: TaskStatus[] = [
  "pending",
  "queued",
  "running",
  "success",
  "failed",
  "cancelled",
];

export const TASK_STATUS_SELECT_OPTIONS: { label: string; value: TaskStatus }[] =
  TASK_STATUS_ORDER.map((s) => ({ label: STATUS_MAP[s].text, value: s }));

export const MULTILINE_TEXT_STYLE = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflow: "hidden",
  whiteSpace: "normal",
  wordBreak: "break-word",
  lineHeight: 1.5,
  textAlign: "left",
  color: "var(--vol-ink)",
} as const;

export const ON_ROW_STYLE = { verticalAlign: "top" } as const;

export function isTerminableTask(task: PublishTask) {
  return TERMINABLE_TASK_STATUSES.has(task.status);
}
