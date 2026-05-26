"use client";

import { AutoComplete } from "antd";

export interface ClipTagSelectProps {
  value: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  style?: React.CSSProperties;
  onChange: (value: string) => void;
}

export function ClipTagSelect({
  value,
  options,
  placeholder = "选择已有标签或输入新标签",
  style,
  onChange,
}: ClipTagSelectProps) {
  return (
    <AutoComplete
      value={value}
      options={options}
      placeholder={placeholder}
      style={style}
      allowClear
      filterOption={(inputValue, option) =>
        String(option?.value ?? "")
          .toLowerCase()
          .includes(inputValue.trim().toLowerCase())
      }
      onChange={(next) => onChange(String(next ?? ""))}
      onSelect={(next) => onChange(String(next ?? ""))}
    />
  );
}
