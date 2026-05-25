import type { CSSProperties } from "react";

export const pageWrapStyle: CSSProperties = {
  width: "100%",
};

export const sectionStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--vol-hairline)",
  borderRadius: 8,
  background: "var(--vol-canvas-soft)",
  padding: 16,
};

export const framePreviewStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "8px 12px",
  border: "1px solid var(--vol-hairline)",
  borderRadius: 8,
  background: "var(--vol-canvas)",
};
