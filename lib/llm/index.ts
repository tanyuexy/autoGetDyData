export * from "./types";
export * from "./siliconflow";
export * from "./deepseek";

import { callDeepSeekStructured } from "./deepseek";
import { callSiliconFlowStructured } from "./siliconflow";
import type { JsonValue, LlmProvider, StructuredRequest, StructuredResult } from "./types";

export async function callStructuredLlm<T extends JsonValue = JsonValue>(
  provider: LlmProvider,
  request: StructuredRequest<T>
): Promise<StructuredResult<T>> {
  if (provider === "deepseek") {
    return callDeepSeekStructured(request);
  }
  return callSiliconFlowStructured(request);
}
