// 脚本侧定时校验（CJS）。规则须与 lib/publishScheduleValidation.ts 保持一致。
const MIN_OFFSET_MS = 2 * 60 * 60 * 1000;
const MAX_OFFSET_MS = 14 * 24 * 60 * 60 * 1000;

function fmtLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * @param {string | null | undefined} scheduleAt
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateScheduleAt(scheduleAt) {
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

/**
 * @param {string | null | undefined} scheduleAt
 */
function assertScheduleAtValid(scheduleAt) {
  const result = validateScheduleAt(scheduleAt);
  if (!result.ok) {
    throw new Error(result.error);
  }
}

/**
 * @param {string | Date} scheduleAt
 */
function formatScheduleAtLocal(scheduleAt) {
  return fmtLocal(scheduleAt);
}

module.exports = {
  validateScheduleAt,
  assertScheduleAtValid,
  formatScheduleAtLocal,
};
