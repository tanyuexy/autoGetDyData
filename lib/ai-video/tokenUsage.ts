import type { AiVideoClipTokenUsage } from "@/types";
import { extractUsage } from "@/lib/llm/shared";

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
    const usage = extractUsage(item);
    const normalized = normalizeTokenUsage({
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });
    if (normalized) return normalized;
  }
  return null;
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
