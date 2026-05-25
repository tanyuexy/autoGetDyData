import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import type { PublishTask } from "@/lib/creator-publish/types";

/** 「立即」（无定时）排在升序最前；有 scheduleAt 的按时间戳排序 */
export function getPublishTaskScheduleSortValue(task: PublishTask): number {
  const raw = task.payload.scheduleAt;
  if (raw == null || !String(raw).trim()) return Number.NEGATIVE_INFINITY;
  const ms = dayjs(raw).valueOf();
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

export const SCHEDULE_SHOW_TIME = { format: "HH:mm" as const, minuteStep: 5 as const };

export function scheduleDisabledDate(current: Dayjs | null) {
  if (!current) return false;
  return current.isBefore(dayjs().startOf("day"));
}

export function scheduleDisabledTime(current: Dayjs | null) {
  if (!current || !current.isSame(dayjs(), "day")) return {};
  const now = dayjs();
  return {
    disabledHours: () => Array.from({ length: now.hour() }, (_, i) => i),
    disabledMinutes: (h: number) =>
      h === now.hour() ? Array.from({ length: now.minute() + 1 }, (_, i) => i) : [],
  };
}

/** 选「定时」时的默认时间：不早于当前时刻 */
export function defaultFutureScheduleIso(): string {
  const t = dayjs().add(1, "hour").startOf("hour");
  return (t.isBefore(dayjs()) ? dayjs().add(2, "hour").startOf("hour") : t).toISOString();
}

export function scheduleQuickPresets() {
  const n = dayjs();
  return [
    { label: "30 分钟后", value: n.add(30, "minute").second(0).millisecond(0) },
    { label: "1 小时后", value: n.add(1, "hour").startOf("hour") },
    { label: "2 小时后", value: n.add(2, "hour").startOf("hour") },
    { label: "明天 09:00", value: n.add(1, "day").hour(9).minute(0).second(0) },
    { label: "明天 12:00", value: n.add(1, "day").hour(12).minute(0).second(0) },
    { label: "后天 09:00", value: n.add(2, "day").hour(9).minute(0).second(0) },
  ];
}

/**
 * 编辑任务用：某一天内、不早于「现在」的 5 分钟档（下拉选，避免 rc-picker 时间列在选中后强制 syncScroll 导致滚动跳动）。
 */
export function buildScheduleTimeOptionsForDay(dateTime: Dayjs) {
  const dayStart = dateTime.startOf("day");
  const now = dayjs();
  const opts: { label: string; value: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      const candidate = dayStart.hour(h).minute(m).second(0).millisecond(0);
      if (candidate.isBefore(now)) continue;
      const label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      opts.push({ label, value: label });
    }
  }
  return opts;
}
