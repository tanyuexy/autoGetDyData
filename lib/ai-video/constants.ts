import type { SeedanceModelOption } from "./types";

export const COMPOSE_GROUP_PRESETS = ["开头", "中间", "结尾"];
export const COMPOSE_GROUP_QUICK_PICKS = ["1", "2", "3", "4", "5"];

/** AI 视频生成页默认模型 */
export const DEFAULT_SEEDANCE_MODEL = "doubao-seedance-2-0-fast-260128";

export const FALLBACK_MODELS: SeedanceModelOption[] = [
  {
    label: "Seedance 2.0",
    value: "doubao-seedance-2-0-260128",
    generation: ["文生视频", "首帧生视频", "首尾帧生视频"],
    note: "质量优先",
  },
  {
    label: "Seedance 2.0 Fast",
    value: "doubao-seedance-2-0-fast-260128",
    generation: ["文生视频", "首帧生视频", "首尾帧生视频"],
    note: "速度优先",
  },
  {
    label: "Seedance 1.5 Pro",
    value: "doubao-seedance-1-5-pro-251215",
    generation: ["文生视频", "首帧生视频"],
    note: "上一代 Pro",
  },
  {
    label: "Seedance 1.0 Pro Fast",
    value: "doubao-seedance-1-0-pro-fast-251015",
    generation: ["文生视频", "首帧生视频"],
    note: "1.0 快速版",
  },
  {
    label: "Seedance 1.0 Pro",
    value: "doubao-seedance-1-0-pro-250528",
    generation: ["文生视频", "首帧生视频"],
    note: "1.0 高质量版",
  },
  {
    label: "Seedance 1.0 Lite T2V",
    value: "doubao-seedance-1-0-lite-t2v-250428",
    generation: ["文生视频"],
    note: "轻量文生视频",
  },
  {
    label: "Seedance 1.0 Lite I2V",
    value: "doubao-seedance-1-0-lite-i2v-250428",
    generation: ["首帧生视频"],
    note: "轻量图生视频",
  },
];

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
