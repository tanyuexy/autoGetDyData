// Next.js / 飞书同步侧定时校验（ESM）。规则须与 scripts/common/publish-schedule-validation.js 保持一致。
const MIN_OFFSET_MS = 2 * 60 * 60 * 1000;
const MAX_OFFSET_MS = 14 * 24 * 60 * 60 * 1000;

function fmtLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type ScheduleValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export function validateScheduleAt(
  scheduleAt: string | null | undefined
): ScheduleValidationResult {
  if (!scheduleAt) return { ok: true };

  const d = new Date(scheduleAt);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: `无效的定时发布时间: ${scheduleAt}` };
  }

  const now = new Date();
  const minTime = new Date(now.getTime() + MIN_OFFSET_MS);
  const maxTime = new Date(now.getTime() + MAX_OFFSET_MS);

  if (d.getTime() <= now.getTime()) {
    return {
      ok: false,
      error: `定时时间不满足平台要求: ${fmtLocal(d)} 已早于当前时间，无法设置定时发布`,
    };
  }
  if (d.getTime() < minTime.getTime()) {
    return {
      ok: false,
      error: `定时时间不满足平台要求: ${fmtLocal(d)} 距当前不足2小时，无法设置定时发布`,
    };
  }
  if (d.getTime() > maxTime.getTime()) {
    return {
      ok: false,
      error: `定时时间不满足平台要求: ${fmtLocal(d)} 超过14天上限，无法设置定时发布`,
    };
  }

  return { ok: true };
}

export function formatFeishuScheduleFailureStatus(errorText: string | undefined): string {
  const raw = String(errorText || "未知错误");
  return `创建失败: ${raw}`.replace(/\s+/g, " ").trim().slice(0, 200);
}
