export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface JsonSchemaObject {
  type?: string | string[];
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  items?: JsonSchemaObject | JsonSchemaObject[];
  enum?: JsonPrimitive[];
  description?: string;
  additionalProperties?: boolean | JsonSchemaObject;
  anyOf?: JsonSchemaObject[];
  oneOf?: JsonSchemaObject[];
  allOf?: JsonSchemaObject[];
  nullable?: boolean;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  [key: string]: unknown;
}

export interface StructuredRequest<T extends JsonValue = JsonValue> {
  model?: string;
  messages: LlmMessage[];
  schemaName: string;
  schema: JsonSchemaObject;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onRawResponse?: (payload: unknown) => void;
  onRawContent?: (content: string) => void;
  validate?: (value: unknown) => value is T;
}

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  defaultTimeoutMs?: number;
  headers?: Record<string, string>;
}

export interface StructuredResult<T extends JsonValue = JsonValue> {
  data: T;
  rawContent: string;
  response: unknown;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export type LlmProvider = "siliconflow" | "deepseek" | "minimax";
