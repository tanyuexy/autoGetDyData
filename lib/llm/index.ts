export * from "./types";
export * from "./siliconflow";
export * from "./deepseek";
export * from "./minimax";
export * from "./minimax-vision";

import { callDeepSeekStructured } from "./deepseek";
import { callMiniMaxStructured } from "./minimax";
import { callSiliconFlowStructured } from "./siliconflow";
import type { JsonValue, LlmProvider, StructuredRequest, StructuredResult } from "./types";

export async function callStructuredLlm<T extends JsonValue = JsonValue>(
  provider: LlmProvider,
  request: StructuredRequest<T>
): Promise<StructuredResult<T>> {
  if (provider === "deepseek") {
    return callDeepSeekStructured(request);
  }
  if (provider === "minimax") {
    return callMiniMaxStructured(request);
  }
  return callSiliconFlowStructured(request);
}
