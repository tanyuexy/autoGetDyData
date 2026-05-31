import type { AiImageJobStatus } from "./types";

/** 纯函数，可供客户端轮询逻辑使用（勿从 jobService 导入，会拖入 MongoDB） */
export function isAiImageJobTerminal(status: AiImageJobStatus) {
  return status === "succeeded" || status === "failed";
}
