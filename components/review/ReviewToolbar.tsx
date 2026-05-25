import { Button, DatePicker, Popconfirm, Space, Tag, Typography } from "antd";
import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { ToolbarMultiSelect } from "@/components/ToolbarMultiSelect";
import { semanticTagStyle } from "@/lib/semanticTagStyles";

const { Text } = Typography;
const { RangePicker } = DatePicker;

type ReviewToolbarProps = {
  toolbarAccountsSanitized: string[];
  onToolbarAccountChange: (values: string[]) => void;
  toolbarAccountSelectOptions: { label: string; value: string; disabled?: boolean }[];
  loadingAccounts: boolean;
  reviewDateRange: [Dayjs, Dayjs] | null;
  onReviewDateRangeChange: (dates: [Dayjs, Dayjs] | null) => void;
  fetching: boolean;
  reviewBusy: boolean;
  onFetchWorkInfo: () => void;
  selectedRowKeysCount: number;
  onBatchDelete: () => void;
  filteredCount: number;
  approvedCount: number;
  needsOptimizationCount: number;
  underReviewCount: number;
  rejectedCount: number;
};

export function ReviewToolbar({
  toolbarAccountsSanitized,
  onToolbarAccountChange,
  toolbarAccountSelectOptions,
  loadingAccounts,
  reviewDateRange,
  onReviewDateRangeChange,
  fetching,
  reviewBusy,
  onFetchWorkInfo,
  selectedRowKeysCount,
  onBatchDelete,
  filteredCount,
  approvedCount,
  needsOptimizationCount,
  underReviewCount,
  rejectedCount,
}: ReviewToolbarProps) {
  return (
    <div
      style={{
        marginBottom: 12,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <Space size={8} wrap>
        <ToolbarMultiSelect
          value={toolbarAccountsSanitized}
          onChange={onToolbarAccountChange}
          options={toolbarAccountSelectOptions}
          loading={loadingAccounts}
          placeholder="选择账号"
        />
        <RangePicker
          style={{ width: 260 }}
          value={reviewDateRange}
          onChange={(dates) => onReviewDateRangeChange(dates as [Dayjs, Dayjs] | null)}
          placeholder={["开始日期", "结束日期"]}
          allowClear
          maxDate={dayjs()}
        />
        <Button
          type="primary"
          onClick={onFetchWorkInfo}
          loading={fetching}
          disabled={reviewBusy}
          icon={<ReloadOutlined />}
        >
          获取作品信息
        </Button>
      </Space>

      <Space size={8} wrap>
        {selectedRowKeysCount > 0 && (
          <Popconfirm
            title={`确定删除选中的 ${selectedRowKeysCount} 条记录？`}
            onConfirm={onBatchDelete}
            okText="确定"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              批量删除 ({selectedRowKeysCount})
            </Button>
          </Popconfirm>
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {filteredCount} 条
        </Text>
        {approvedCount > 0 && (
          <Tag style={{ ...semanticTagStyle("success"), margin: 0 }}>
            发布 {approvedCount}
          </Tag>
        )}
        {needsOptimizationCount > 0 && (
          <Tag style={{ ...semanticTagStyle("warning"), margin: 0 }}>
            需优化 {needsOptimizationCount}
          </Tag>
        )}
        {underReviewCount > 0 && (
          <Tag style={{ ...semanticTagStyle("processing"), margin: 0 }}>
            审核 {underReviewCount}
          </Tag>
        )}
        {rejectedCount > 0 && (
          <Tag style={{ ...semanticTagStyle("error"), margin: 0 }}>
            拒绝 {rejectedCount}
          </Tag>
        )}
      </Space>
    </div>
  );
}
