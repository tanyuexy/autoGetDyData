import type { CSSProperties } from "react";

/**
 * Ant Design Tag 的 `color` 预设会随主题变成「深底深字」（尤其 `processing`）。
 * 这里用固定浅底 + 深色字，保证在炭灰主色 / 奶油底等主题下可读。
 */
const BASE: Record<
  "success" | "warning" | "error" | "processing" | "default" | "blue",
  CSSProperties
> = {
  success: {
    background: "#dcfce7",
    color: "#166534",
    border: "1px solid #86efac",
  },
  warning: {
    background: "#fef3c7",
    color: "#b45309",
    border: "1px solid #fcd34d",
  },
  error: {
    background: "#fee2e2",
    color: "#b91c1c",
    border: "1px solid #fca5a5",
  },
  processing: {
    background: "#dbeafe",
    color: "#1e3a8a",
    border: "1px solid #93c5fd",
  },
  default: {
    background: "#f4f4f5",
    color: "#3f3f46",
    border: "1px solid #d4d4d8",
  },
  blue: {
    background: "#dbeafe",
    color: "#1e40af",
    border: "1px solid #93c5fd",
  },
};

export type SemanticTagPreset = keyof typeof BASE;

export function semanticTagStyle(preset: SemanticTagPreset): CSSProperties {
  return BASE[preset];
}

/** 对应 Ant Design Tag 的 `color` 字符串（与主题解耦） */
export function antdTagPresetStyle(color: string | undefined): CSSProperties {
  if (!color) return BASE.default;
  if (color in BASE) return BASE[color as SemanticTagPreset];
  return BASE.default;
}
