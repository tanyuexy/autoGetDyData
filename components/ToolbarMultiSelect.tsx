import { Select } from "antd";
import type { ToolbarSelectOption } from "@/hooks/useToolbarMultiSelect";

type ToolbarMultiSelectProps = {
  value: string[];
  onChange: (values: string[]) => void;
  options: ToolbarSelectOption[];
  loading?: boolean;
  placeholder?: string;
  minWidth?: number;
  size?: "small" | "middle" | "large";
  maxTagCount?: number;
};

export function ToolbarMultiSelect({
  value,
  onChange,
  options,
  loading,
  placeholder = "选择账号",
  minWidth = 240,
  size,
  maxTagCount = 3,
}: ToolbarMultiSelectProps) {
  return (
    <Select
      mode="multiple"
      allowClear
      style={{ minWidth }}
      value={value}
      onChange={onChange}
      options={options}
      loading={loading}
      placeholder={placeholder}
      maxTagCount={maxTagCount}
      size={size}
    />
  );
}
