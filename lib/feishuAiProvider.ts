import type { FeishuAiProvider } from "@/types";

export function normalizeFeishuAiProvider(raw: unknown): FeishuAiProvider {
  return String(raw || "").trim() === "deepseek" ? "deepseek" : "siliconflow";
}

export const FEISHU_AI_PROVIDER_OPTIONS: { label: string; value: FeishuAiProvider }[] = [
  { label: "SiliconFlow", value: "siliconflow" },
  { label: "DeepSeek", value: "deepseek" },
];
