import type {
  ClientOptions,
  JsonValue,
  StructuredRequest,
  StructuredResult,
} from "./types";
import {
  buildStructuredPayload,
  extractMessageContent,
  extractUsage,
  normalizeBaseUrl,
  parsePositiveInt,
  parseStructuredContent,
  postOpenAICompatibleJson,
  resolveClientOptionTimeout,
} from "./shared";

export interface MiniMaxClientOptions extends ClientOptions {}
export interface MiniMaxStructuredRequest<T extends JsonValue = JsonValue>
  extends StructuredRequest<T> {}
export interface MiniMaxStructuredResult<T extends JsonValue = JsonValue>
  extends StructuredResult<T> {}

const DEFAULT_BASE_URL =
  process.env.MINIMAX_BASE_URL?.trim() || "https://api.minimaxi.com/v1";
const DEFAULT_MODEL = process.env.MINIMAX_MODEL?.trim() || "MiniMax-M2.7";
const DEFAULT_TIMEOUT_MS = parsePositiveInt(
  process.env.MINIMAX_TIMEOUT_MS,
  60_000
);
const PROVIDER_LABEL = "MiniMax";

function stripThinkingTags(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, "").trim();
}

function extractMiniMaxMessageContent(response: unknown, providerLabel: string): string {
  const root = response && typeof response === "object" ? (response as Record<string, unknown>) : {};
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice =
    choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>) : {};
  const message =
    firstChoice.message && typeof firstChoice.message === "object"
      ? (firstChoice.message as Record<string, unknown>)
      : {};

  let directContent = "";
  try {
    directContent = extractMessageContent(response, providerLabel);
  } catch {
    directContent = "";
  }
  if (directContent.trim()) return directContent;

  const reasoningDetails = Array.isArray(message.reasoning_details) ? message.reasoning_details : [];
  const reasoningText = reasoningDetails
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .join("\n")
    .trim();
  if (reasoningText) return reasoningText;

  throw new Error(`${providerLabel} 返回中缺少 choices[0].message.content`);
}

function buildMinimaxStructuredPayload(request: StructuredRequest, model: string) {
  const base = buildStructuredPayload({ ...request, model }) as Record<string, unknown>;
  const { response_format: _responseFormat, ...rest } = base;

  return {
    ...rest,
    model,
    reasoning_split: true,
  };
}

function parseMiniMaxStructuredContent<T extends JsonValue>(
  rawContent: string,
  request: StructuredRequest<T>
): JsonValue {
  try {
    return parseStructuredContent(rawContent, PROVIDER_LABEL);
  } catch (error) {
    // MiniMax 常忽略 json_schema，直接返回正文纯文本；飞书 AI 正文场景可兜底
    if (request.schemaName === "feishu_task_content") {
      const content = rawContent.trim();
      if (content) return { content };
    }
    if (request.schemaName === "seedance_video_prompts") {
      const content = rawContent.trim();
      if (content) return { _rawMarkdown: content };
    }
    throw error;
  }
}

function finalizeMiniMaxStructuredResult<T extends JsonValue>(
  response: unknown,
  request: StructuredRequest<T>,
): StructuredResult<T> {
  request.onRawResponse?.(response);
  const rawContent = stripThinkingTags(extractMiniMaxMessageContent(response, PROVIDER_LABEL));
  request.onRawContent?.(rawContent);
  const parsed = parseMiniMaxStructuredContent(rawContent, request);
  if (request.validate && !request.validate(parsed)) {
    throw new Error(`${PROVIDER_LABEL} 返回数据未通过 validate 校验`);
  }
  return {
    data: parsed as T,
    rawContent,
    response,
    usage: extractUsage(response),
  };
}

export function createMiniMaxClient(options: MiniMaxClientOptions = {}) {
  const apiKey =
    options.apiKey?.trim() ||
    process.env.MINIMAX_API_KEY?.trim() ||
    process.env.MINIMAX_TOKEN_PLAN_KEY?.trim() ||
    "";
  const baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_BASE_URL, DEFAULT_BASE_URL);
  const defaultModel = options.defaultModel?.trim() || DEFAULT_MODEL;
  const defaultTimeoutMs = resolveClientOptionTimeout(options, DEFAULT_TIMEOUT_MS);
  const defaultHeaders = options.headers || {};

  if (!apiKey) {
    throw new Error(
      "缺少 MiniMax API Key，请设置 MINIMAX_API_KEY（Token Plan Key 或按量计费 Key 均可）"
    );
  }

  async function structured<T extends JsonValue = JsonValue>(
    request: MiniMaxStructuredRequest<T>
  ): Promise<MiniMaxStructuredResult<T>> {
    const model = request.model?.trim() || defaultModel;
    if (!model) {
      throw new Error("缺少 MiniMax 模型名，请传入 model 或设置 MINIMAX_MODEL");
    }
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw new Error("messages 不能为空");
    }
    if (!request.schemaName || !request.schemaName.trim()) {
      throw new Error("schemaName 不能为空");
    }
    if (!request.schema || typeof request.schema !== "object") {
      throw new Error("schema 必须是 JSON Schema 对象");
    }

    const response = await postOpenAICompatibleJson({
      url: `${baseUrl}/chat/completions`,
      apiKey,
      body: buildMinimaxStructuredPayload(request, model),
      timeoutMs: request.timeoutMs || defaultTimeoutMs,
      signal: request.signal,
      headers: defaultHeaders,
      providerLabel: PROVIDER_LABEL,
    });

    return finalizeMiniMaxStructuredResult(response, request);
  }

  return {
    structured,
  };
}

export async function callMiniMaxStructured<T extends JsonValue = JsonValue>(
  request: MiniMaxStructuredRequest<T>,
  clientOptions: MiniMaxClientOptions = {}
): Promise<MiniMaxStructuredResult<T>> {
  return createMiniMaxClient(clientOptions).structured(request);
}
