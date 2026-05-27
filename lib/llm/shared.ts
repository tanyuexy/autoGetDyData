import type { ClientOptions, JsonValue, StructuredRequest, StructuredResult } from "./types";

export function normalizeBaseUrl(value: string, fallback: string): string {
  return String(value || fallback).replace(/\/+$/, "");
}

export function parsePositiveInt(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

export function toNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function firstNonEmptyString(...values: string[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function safeJsonParse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function tryParseJsonValue(value: string): JsonValue | undefined {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return undefined;
  }
}

export function parseStructuredContent(content: string, providerLabel: string): JsonValue {
  const trimmed = String(content || "").trim();
  if (!trimmed) {
    throw new Error(`${providerLabel} 返回空内容，无法解析结构化结果`);
  }

  const direct = tryParseJsonValue(trimmed);
  if (direct !== undefined) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const parsed = tryParseJsonValue(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }

  const objStart = trimmed.indexOf("{");
  const objEnd = trimmed.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    const parsed = tryParseJsonValue(trimmed.slice(objStart, objEnd + 1));
    if (parsed !== undefined) return parsed;
  }

  const arrStart = trimmed.indexOf("[");
  const arrEnd = trimmed.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    const parsed = tryParseJsonValue(trimmed.slice(arrStart, arrEnd + 1));
    if (parsed !== undefined) return parsed;
  }

  throw new Error(`无法从 ${providerLabel} 返回内容中解析 JSON: ${trimmed}`);
}

export function extractMessageContent(response: unknown, providerLabel: string): string {
  const root = asRecord(response);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice.message);
  const directContent = message.content;

  if (typeof directContent === "string" && directContent.trim()) {
    return directContent.trim();
  }

  if (Array.isArray(directContent)) {
    const merged = directContent
      .map((part) => {
        if (typeof part === "string") return part;
        const obj = asRecord(part);
        if (typeof obj.text === "string") return obj.text;
        return "";
      })
      .join("\n")
      .trim();
    if (merged) return merged;
  }

  throw new Error(`${providerLabel} 返回中缺少 choices[0].message.content`);
}

export function extractUsage(response: unknown) {
  const root = asRecord(response);
  const usage = asRecord(root.usage);
  return {
    promptTokens: toNumberOrUndefined(usage.prompt_tokens),
    completionTokens: toNumberOrUndefined(usage.completion_tokens),
    totalTokens: toNumberOrUndefined(usage.total_tokens),
  };
}

export function extractErrorMessage(data: unknown, fallbackText: string): string {
  const root = asRecord(data);
  const error = asRecord(root.error);
  return (
    firstNonEmptyString(
      typeof error.message === "string" ? error.message : "",
      typeof root.message === "string" ? root.message : "",
      typeof root.msg === "string" ? root.msg : "",
      fallbackText
    ) || "未知错误"
  );
}

export async function postOpenAICompatibleJson({
  url,
  apiKey,
  body,
  timeoutMs,
  signal,
  headers,
  providerLabel,
}: {
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  providerLabel: string;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const abortForwarder = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortForwarder, { once: true });
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    const data = safeJsonParse(text);

    if (!res.ok) {
      throw new Error(
        `${providerLabel} HTTP ${res.status}: ${extractErrorMessage(data, text)}`
      );
    }

    if (!data || typeof data !== "object") {
      throw new Error(`${providerLabel} 返回非 JSON 对象: ${text || "<empty>"}`);
    }

    const maybeError = (data as Record<string, unknown>).error;
    if (maybeError) {
      throw new Error(`${providerLabel} 接口错误: ${extractErrorMessage(data, text)}`);
    }

    return data;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new Error(`${providerLabel} 请求超时或已取消（${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener("abort", abortForwarder);
  }
}

export function buildStructuredPayload(request: StructuredRequest) {
  return {
    model: request.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: String(message.content ?? ""),
    })),
    temperature: typeof request.temperature === "number" ? request.temperature : 0,
    top_p: typeof request.topP === "number" ? request.topP : undefined,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: request.schemaName.trim(),
        schema: request.schema,
      },
    },
  };
}

export function finalizeStructuredResult<T extends JsonValue>(
  response: unknown,
  request: StructuredRequest<T>,
  providerLabel: string
): StructuredResult<T> {
  request.onRawResponse?.(response);
  const rawContent = extractMessageContent(response, providerLabel);
  request.onRawContent?.(rawContent);
  const parsed = parseStructuredContent(rawContent, providerLabel);
  if (request.validate && !request.validate(parsed)) {
    throw new Error(`${providerLabel} 返回数据未通过 validate 校验`);
  }
  return {
    data: parsed as T,
    rawContent,
    response,
    usage: extractUsage(response),
  };
}

export function resolveRequestModel(
  request: StructuredRequest,
  defaultModel: string,
  providerLabel: string
): string {
  const model = request.model?.trim() || defaultModel;
  if (!model) {
    throw new Error(`缺少 ${providerLabel} 模型名，请传入 model 或设置对应环境变量`);
  }
  return model;
}

export function validateStructuredRequest(
  request: StructuredRequest,
  providerLabel: string
) {
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new Error("messages 不能为空");
  }
  if (!request.schemaName || !request.schemaName.trim()) {
    throw new Error("schemaName 不能为空");
  }
  if (!request.schema || typeof request.schema !== "object") {
    throw new Error("schema 必须是 JSON Schema 对象");
  }
  resolveRequestModel(request, "", providerLabel);
}

export function resolveClientOptionTimeout(
  options: ClientOptions,
  defaultTimeoutMs: number
): number {
  return options.defaultTimeoutMs && options.defaultTimeoutMs > 0
    ? options.defaultTimeoutMs
    : defaultTimeoutMs;
}
