export interface SeedanceDurationConfig {
  min: number;
  max: number;
  default: number;
}

/** 各模型 duration 取值范围，对齐火山 Seedance API（整数秒） */
const SEEDANCE_DURATION_BY_MODEL: Record<string, SeedanceDurationConfig> = {
  "doubao-seedance-2-0-260128": { min: 4, max: 15, default: 5 },
  "doubao-seedance-2-0-fast-260128": { min: 4, max: 15, default: 5 },
  "doubao-seedance-1-5-pro-251215": { min: 2, max: 12, default: 5 },
  "doubao-seedance-1-0-pro-fast-251015": { min: 2, max: 12, default: 5 },
  "doubao-seedance-1-0-pro-250528": { min: 2, max: 12, default: 5 },
  "doubao-seedance-1-0-lite-t2v-250428": { min: 5, max: 10, default: 5 },
  "doubao-seedance-1-0-lite-i2v-250428": { min: 5, max: 10, default: 5 },
};

const DEFAULT_SEEDANCE_DURATION: SeedanceDurationConfig = { min: 2, max: 12, default: 5 };

export function getSeedanceDurationConfig(model: string): SeedanceDurationConfig {
  const cleaned = String(model || "").trim();
  if (cleaned in SEEDANCE_DURATION_BY_MODEL) return SEEDANCE_DURATION_BY_MODEL[cleaned];
  if (cleaned.includes("seedance-2-0")) return { min: 4, max: 15, default: 5 };
  if (cleaned.includes("1-0-lite")) return { min: 5, max: 10, default: 5 };
  if (cleaned.includes("seedance")) return { min: 2, max: 12, default: 5 };
  return DEFAULT_SEEDANCE_DURATION;
}

export function normalizeSeedanceDuration(model: string, duration?: number | null): number {
  const cfg = getSeedanceDurationConfig(model);
  const raw =
    typeof duration === "number" && Number.isFinite(duration) ? Math.round(duration) : cfg.default;
  return Math.min(cfg.max, Math.max(cfg.min, raw));
}
