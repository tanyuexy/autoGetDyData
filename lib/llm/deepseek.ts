import type {
  ClientOptions,
  JsonValue,
  StructuredRequest,
  StructuredResult,
} from "./types";
import {
  buildStructuredPayload,
  finalizeStructuredResult,
  normalizeBaseUrl,
  parsePositiveInt,
  postOpenAICompatibleJson,
  resolveClientOptionTimeout,
} from "./shared";

export interface DeepSeekClientOptions extends ClientOptions {}
export interface DeepSeekStructuredRequest<T extends JsonValue = JsonValue>
  extends StructuredRequest<T> {}
export interface DeepSeekStructuredResult<T extends JsonValue = JsonValue>
  extends StructuredResult<T> {}

const DEFAULT_BASE_URL =
  process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1";
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL?.trim() || "";
const DEFAULT_TIMEOUT_MS = parsePositiveInt(
  process.env.DEEPSEEK_TIMEOUT_MS,
  60_000
);
const PROVIDER_LABEL = "DeepSeek";

export function createDeepSeekClient(options: DeepSeekClientOptions = {}) {
  const apiKey =
    options.apiKey?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || "";
  const baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_BASE_URL, DEFAULT_BASE_URL);
  const defaultModel = options.defaultModel?.trim() || DEFAULT_MODEL;
  const defaultTimeoutMs = resolveClientOptionTimeout(options, DEFAULT_TIMEOUT_MS);
  const defaultHeaders = options.headers || {};

  if (!apiKey) {
    throw new Error("缺少 DeepSeek API Key，请设置 DEEPSEEK_API_KEY");
  }

  async function structured<T extends JsonValue = JsonValue>(
    request: DeepSeekStructuredRequest<T>
  ): Promise<DeepSeekStructuredResult<T>> {
    const model = request.model?.trim() || defaultModel;
    if (!model) {
      throw new Error(
        "缺少 DeepSeek 模型名，请传入 model 或设置 DEEPSEEK_MODEL"
      );
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
      body: {
        ...buildStructuredPayload({ ...request, model }),
        model,
      },
      timeoutMs: request.timeoutMs || defaultTimeoutMs,
      signal: request.signal,
      headers: defaultHeaders,
      providerLabel: PROVIDER_LABEL,
    });

    return finalizeStructuredResult(response, request, PROVIDER_LABEL);
  }

  return {
    structured,
  };
}

export async function callDeepSeekStructured<T extends JsonValue = JsonValue>(
  request: DeepSeekStructuredRequest<T>,
  clientOptions: DeepSeekClientOptions = {}
): Promise<DeepSeekStructuredResult<T>> {
  return createDeepSeekClient(clientOptions).structured(request);
}
