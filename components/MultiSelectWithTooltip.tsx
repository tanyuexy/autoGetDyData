"use client";

import { Select, Tooltip } from "antd";
import type { SelectProps } from "antd";
import { useMemo } from "react";

type SelectOption = {
  label?: React.ReactNode;
  value?: string | number | null;
};

function resolveSelectedLabels(
  value: SelectProps["value"],
  options: SelectProps["options"]
): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];

  const labelByValue = new Map<string, string>();
  for (const option of (options || []) as SelectOption[]) {
    if (option?.value === undefined || option?.value === null) continue;
    const key = String(option.value);
    const label =
      typeof option.label === "string" || typeof option.label === "number"
        ? String(option.label)
        : key;
    labelByValue.set(key, label);
  }

  return value.map((item) => labelByValue.get(String(item)) ?? String(item));
}

export function MultiSelectWithTooltip(props: SelectProps) {
  const { value, options, style, ...rest } = props;

  const selectedLabels = useMemo(
    () => resolveSelectedLabels(value, options),
    [value, options]
  );

  const tooltipTitle =
    selectedLabels.length > 0 ? (
      <div
        style={{
          whiteSpace: "pre-wrap",
          maxWidth: 420,
          maxHeight: 320,
          overflow: "auto",
        }}
      >
        {selectedLabels.join("\n")}
      </div>
    ) : undefined;

  const select = (
    <Select mode="multiple" value={value} options={options} style={style} {...rest} />
  );

  if (!tooltipTitle) return select;

  return (
    <Tooltip title={tooltipTitle} placement="top">
      <span style={{ display: "inline-block", width: style?.width, minWidth: style?.minWidth }}>
        {select}
      </span>
    </Tooltip>
  );
}
