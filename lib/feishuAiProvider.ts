import type { FeishuAiProvider } from "@/types";

export function normalizeFeishuAiProvider(raw: unknown): FeishuAiProvider {
  const value = String(raw || "").trim();
  if (value === "deepseek") return "deepseek";
  if (value === "siliconflow") return "siliconflow";
  return "minimax";
}

export const FEISHU_AI_PROVIDER_OPTIONS: { label: string; value: FeishuAiProvider }[] = [
  { label: "MiniMax", value: "minimax" },
  { label: "SiliconFlow", value: "siliconflow" },
  { label: "DeepSeek", value: "deepseek" },
];
