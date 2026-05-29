"use client";

import { Select, Tooltip } from "antd";
import type { SelectProps } from "antd";
import { useCallback, useMemo } from "react";

type SelectOption = {
  label?: React.ReactNode;
  value?: string | number | null;
};

function optionLabel(option: SelectOption): string {
  if (typeof option.label === "string" || typeof option.label === "number") {
    return String(option.label);
  }
  if (option.value !== undefined && option.value !== null) {
    return String(option.value);
  }
  return "";
}

function resolveSelectedLabel(value: SelectProps["value"], options: SelectProps["options"]): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  for (const option of (options || []) as SelectOption[]) {
    if (option?.value === undefined || option?.value === null) continue;
    if (String(option.value) === String(value)) {
      return optionLabel(option);
    }
  }
  return String(value);
}

export function SelectWithTooltip(props: SelectProps) {
  const { value, options, style, optionRender, ...rest } = props;

  const selectedLabel = useMemo(
    () => resolveSelectedLabel(value, options),
    [value, options]
  );

  const mergedOptionRender = useCallback<NonNullable<SelectProps["optionRender"]>>(
    (option, info) => {
      const label = optionLabel(option as SelectOption);
      const content = optionRender ? optionRender(option, info) : label;
      return (
        <div
          title={label}
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {content}
        </div>
      );
    },
    [optionRender]
  );

  const select = (
    <Select
      value={value}
      options={options}
      style={style}
      optionRender={mergedOptionRender}
      {...rest}
    />
  );

  if (!selectedLabel) return select;

  return (
    <Tooltip title={selectedLabel} placement="top">
      <span style={{ display: "inline-block", width: style?.width, minWidth: style?.minWidth }}>
        {select}
      </span>
    </Tooltip>
  );
}
