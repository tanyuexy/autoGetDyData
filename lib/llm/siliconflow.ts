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

export interface SiliconFlowClientOptions extends ClientOptions {}
export interface SiliconFlowStructuredRequest<T extends JsonValue = JsonValue>
  extends StructuredRequest<T> {}
export interface SiliconFlowStructuredResult<T extends JsonValue = JsonValue>
  extends StructuredResult<T> {}

const DEFAULT_BASE_URL =
  process.env.SILICONFLOW_BASE_URL?.trim() || "https://api.siliconflow.cn/v1";
const DEFAULT_MODEL = process.env.SILICONFLOW_MODEL?.trim() || "";
const DEFAULT_TIMEOUT_MS = parsePositiveInt(
  process.env.SILICONFLOW_TIMEOUT_MS,
  60_000
);
const PROVIDER_LABEL = "SiliconFlow";

export function createSiliconFlowClient(options: SiliconFlowClientOptions = {}) {
  const apiKey =
    options.apiKey?.trim() || process.env.SILICONFLOW_API_KEY?.trim() || "";
  const baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_BASE_URL, DEFAULT_BASE_URL);
  const defaultModel = options.defaultModel?.trim() || DEFAULT_MODEL;
  const defaultTimeoutMs = resolveClientOptionTimeout(options, DEFAULT_TIMEOUT_MS);
  const defaultHeaders = options.headers || {};

  if (!apiKey) {
    throw new Error("缺少 SiliconFlow API Key，请设置 SILICONFLOW_API_KEY");
  }

  async function structured<T extends JsonValue = JsonValue>(
    request: SiliconFlowStructuredRequest<T>
  ): Promise<SiliconFlowStructuredResult<T>> {
    const model = request.model?.trim() || defaultModel;
    if (!model) {
      throw new Error(
        "缺少 SiliconFlow 模型名，请传入 model 或设置 SILICONFLOW_MODEL"
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

export async function callSiliconFlowStructured<T extends JsonValue = JsonValue>(
  request: SiliconFlowStructuredRequest<T>,
  clientOptions: SiliconFlowClientOptions = {}
): Promise<SiliconFlowStructuredResult<T>> {
  return createSiliconFlowClient(clientOptions).structured(request);
}
