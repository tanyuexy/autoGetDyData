/** API + Worker + 配置页共用：发布后 Playwright 进程并发上限 */

export const PUBLISH_MAX_CONCURRENT_HARD_MAX = 20;
export const PUBLISH_MAX_CONCURRENT_DEFAULT = 3;

export function normalizePublishMaxConcurrent(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return PUBLISH_MAX_CONCURRENT_DEFAULT;
  const floored = Math.floor(n);
  return Math.min(
    PUBLISH_MAX_CONCURRENT_HARD_MAX,
    Math.max(1, floored || PUBLISH_MAX_CONCURRENT_DEFAULT)
  );
}
