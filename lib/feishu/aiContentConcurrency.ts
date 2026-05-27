/** 飞书 AI 正文生成：同时请求的 LLM 条数上限 */

export const FEISHU_AI_CONTENT_MAX_CONCURRENT_HARD_MAX = 10;
export const FEISHU_AI_CONTENT_MAX_CONCURRENT_DEFAULT = 3;

export function normalizeFeishuAiContentMaxConcurrent(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return FEISHU_AI_CONTENT_MAX_CONCURRENT_DEFAULT;
  const floored = Math.floor(n);
  return Math.min(
    FEISHU_AI_CONTENT_MAX_CONCURRENT_HARD_MAX,
    Math.max(1, floored || FEISHU_AI_CONTENT_MAX_CONCURRENT_DEFAULT)
  );
}
