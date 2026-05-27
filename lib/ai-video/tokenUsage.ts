import type { AiVideoClipTokenUsage } from "@/types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickTokenField(usage: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const n = Number(usage[key]);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return undefined;
}

/** 解析方舟/Seedance 等视频任务响应中的 usage（字段名与 Chat API 不完全一致） */
function extractUsageFromUnknown(item: unknown) {
  const root = asRecord(item);
  const usageObjects = [
    root.usage,
    root.token_usage,
    asRecord(root.data).usage,
    asRecord(root.result).usage,
  ];

  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let totalTokens: number | undefined;

  for (const raw of usageObjects) {
    const usage = asRecord(raw);
    if (!Object.keys(usage).length) continue;
    promptTokens ??= pickTokenField(usage, [
      "prompt_tokens",
      "input_tokens",
      "prompt_token_count",
      "input_token_count",
    ]);
    completionTokens ??= pickTokenField(usage, [
      "completion_tokens",
      "output_tokens",
      "completion_token_count",
      "output_token_count",
    ]);
    totalTokens ??= pickTokenField(usage, ["total_tokens", "total_token_count"]);
  }

  if (totalTokens == null && (promptTokens != null || completionTokens != null)) {
    totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
  }

  return { promptTokens, completionTokens, totalTokens };
}

export function normalizeTokenUsage(
  input?: Partial<AiVideoClipTokenUsage> | null
): AiVideoClipTokenUsage | null {
  if (!input || typeof input !== "object") return null;
  const promptTokens = toNonNegativeInt(input.promptTokens);
  const completionTokens = toNonNegativeInt(input.completionTokens);
  const explicitTotal = toNonNegativeInt(input.totalTokens);
  const totalTokens =
    explicitTotal ??
    (promptTokens != null || completionTokens != null
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : null);
  if (totalTokens == null || totalTokens <= 0) return null;
  return {
    ...(promptTokens != null ? { promptTokens } : {}),
    ...(completionTokens != null ? { completionTokens } : {}),
    totalTokens,
  };
}

export function mergeTokenUsage(
  base?: Partial<AiVideoClipTokenUsage> | null,
  extra?: Partial<AiVideoClipTokenUsage> | null
): AiVideoClipTokenUsage | null {
  const a = normalizeTokenUsage(base);
  const b = normalizeTokenUsage(extra);
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  const promptTokens = sumOptional(a.promptTokens, b.promptTokens);
  const completionTokens = sumOptional(a.completionTokens, b.completionTokens);
  return normalizeTokenUsage({
    promptTokens,
    completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  });
}

export function extractTokenUsageFromResponse(response: unknown): AiVideoClipTokenUsage | null {
  if (!response || typeof response !== "object") return null;
  const root = response as Record<string, unknown>;
  const candidates = [root, root.data, root.result, root.output];
  for (const item of candidates) {
    const usage = extractUsageFromUnknown(item);
    const normalized = normalizeTokenUsage({
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });
    if (normalized) return normalized;
  }
  return null;
}

/** 悬浮明细：无输入 token 时不用「输出」，避免与 Chat 语义混淆 */
export function formatTokenUsageTooltipLines(usage?: AiVideoClipTokenUsage | null): string[] {
  const normalized = normalizeTokenUsage(usage);
  if (!normalized) return [];
  const lines: string[] = [];
  if (normalized.promptTokens != null) {
    lines.push(`输入：${formatTokenCountCompact(normalized.promptTokens)}`);
  }
  if (normalized.completionTokens != null) {
    const label = normalized.promptTokens == null ? "视频生成" : "输出";
    lines.push(`${label}：${formatTokenCountCompact(normalized.completionTokens)}`);
  }
  lines.push(`合计：${formatTokenCountCompact(normalized.totalTokens)}`);
  return lines;
}

/** 如 999 → "999"，12345 → "12.3k" */
export function formatTokenCountCompact(value: number): string {
  const n = Math.round(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(n);
  const compact = Math.round((n / 1000) * 10) / 10;
  return Number.isInteger(compact) ? `${compact}k` : `${compact}k`;
}

export function formatTokenUsageLabel(usage?: AiVideoClipTokenUsage | null): string {
  const normalized = normalizeTokenUsage(usage);
  if (!normalized) return "—";
  return formatTokenCountCompact(normalized.totalTokens);
}

function toNonNegativeInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function sumOptional(a?: number, b?: number): number | undefined {
  if (a == null && b == null) return undefined;
  return (a ?? 0) + (b ?? 0);
}
