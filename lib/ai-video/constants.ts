import type { SeedanceModelOption } from "./types";

export const COMPOSE_GROUP_PRESETS = ["开头", "中间", "结尾"];
export const COMPOSE_GROUP_QUICK_PICKS = ["1", "2", "3", "4", "5"];

/** AI 视频生成页默认模型（质量版 2.0） */
export const DEFAULT_SEEDANCE_MODEL = "doubao-seedance-2-0-260128";

/** 下拉里展示但禁止选择的模型 */
export const DISABLED_SEEDANCE_MODEL_VALUES = new Set<string>(["doubao-seedance-2-0-fast-260128"]);

/** 生成页模型列表（仅 Seedance 2.0 系列；Fast 为禁用项） */
export const SEEDANCE_MODELS: SeedanceModelOption[] = [
  {
    label: "Seedance 2.0",
    value: "doubao-seedance-2-0-260128",
    generation: ["文生视频", "首帧生视频", "首尾帧生视频", "多模态参考"],
    note: "质量优先，适合成片主镜头",
  },
  {
    label: "Seedance 2.0 Fast",
    value: "doubao-seedance-2-0-fast-260128",
    generation: ["文生视频", "首帧生视频", "首尾帧生视频", "多模态参考"],
    note: "速度优先，适合批量出片段",
  },
];

export const FALLBACK_MODELS = SEEDANCE_MODELS;

const SELECTABLE_SEEDANCE_MODEL_VALUES = new Set(
  SEEDANCE_MODELS.map((item) => item.value).filter((value) => !DISABLED_SEEDANCE_MODEL_VALUES.has(value))
);

/** 历史片段展示用：含已下线的 1.x 模型名 */
export const SEEDANCE_MODEL_LABEL_BY_VALUE: Record<string, string> = {
  "doubao-seedance-1-5-pro-251215": "Seedance 1.5 Pro",
  "doubao-seedance-1-0-pro-fast-251015": "Seedance 1.0 Pro Fast",
  "doubao-seedance-1-0-pro-250528": "Seedance 1.0 Pro",
  "doubao-seedance-1-0-lite-t2v-250428": "Seedance 1.0 Lite T2V",
  "doubao-seedance-1-0-lite-i2v-250428": "Seedance 1.0 Lite I2V",
  ...Object.fromEntries(SEEDANCE_MODELS.map((item) => [item.value, item.label])),
};

export function isDisabledSeedanceModel(model: string): boolean {
  return DISABLED_SEEDANCE_MODEL_VALUES.has(String(model || "").trim());
}

export function isSelectableSeedanceModel(model: string): boolean {
  return SELECTABLE_SEEDANCE_MODEL_VALUES.has(String(model || "").trim());
}

export function resolveSelectableSeedanceModel(model: string | undefined): string {
  const cleaned = String(model || "").trim();
  return isSelectableSeedanceModel(cleaned) ? cleaned : DEFAULT_SEEDANCE_MODEL;
}

export const RATIO_OPTIONS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].map((value) => ({
  label: value,
  value,
}));

export const RESOLUTION_OPTIONS = ["480p", "720p", "1080p"].map((value) => ({
  label: value,
  value,
}));

export const REFERENCE_CACHE_KEY = "ai-video:seedance-reference-resources";
export const CONFIG_CACHE_KEY = "ai-video:seedance-config";
export const LEGACY_CLIPS_CACHE_KEY = "ai-video:seedance-clips";
