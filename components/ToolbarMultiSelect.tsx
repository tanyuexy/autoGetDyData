import type { ToolbarSelectOption } from "@/hooks/useToolbarMultiSelect";
import { MultiSelectWithTooltip } from "@/components/MultiSelectWithTooltip";

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
    <MultiSelectWithTooltip
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
