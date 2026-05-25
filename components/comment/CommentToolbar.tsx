import { Button, InputNumber, Space, Tag, Tooltip, Typography } from "antd";
import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import { ToolbarMultiSelect } from "@/components/ToolbarMultiSelect";
import { semanticTagStyle } from "@/lib/semanticTagStyles";

const { Text } = Typography;

type CommentToolbarProps = {
  toolbarAccountsSanitized: string[];
  onToolbarAccountChange: (values: string[]) => void;
  toolbarAccountSelectOptions: { label: string; value: string; disabled?: boolean }[];
  loadingAccounts: boolean;
  maxWorks: number;
  onMaxWorksChange: (value: number) => void;
  fetching: boolean;
  commentBusy: boolean;
  onFetchComments: () => void;
  selectedRowKeysCount: number;
  onBatchDelete: () => void;
  totalComments: number;
  accountStats: Map<string, number>;
};

export function CommentToolbar({
  toolbarAccountsSanitized,
  onToolbarAccountChange,
  toolbarAccountSelectOptions,
  loadingAccounts,
  maxWorks,
  onMaxWorksChange,
  fetching,
  commentBusy,
  onFetchComments,
  selectedRowKeysCount,
  onBatchDelete,
  totalComments,
  accountStats,
}: CommentToolbarProps) {
  return (
    <div
      style={{
        marginBottom: 12,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <Space size={12} wrap align="center">
        <ToolbarMultiSelect
          value={toolbarAccountsSanitized}
          onChange={onToolbarAccountChange}
          options={toolbarAccountSelectOptions}
          loading={loadingAccounts}
          placeholder="选择账号"
          size="middle"
        />
        <Tooltip title="每个账号抓取的作品数">
          <span style={{ display: "inline-flex", verticalAlign: "middle" }}>
            <Space.Compact>
              <Button type="default" disabled tabIndex={-1} size="middle">
                前
              </Button>
              <InputNumber
                min={1}
                max={50}
                size="middle"
                value={maxWorks}
                onChange={(v) => onMaxWorksChange(v ?? 10)}
                controls={false}
                style={{ width: 56 }}
              />
              <Button type="default" disabled tabIndex={-1} size="middle">
                个
              </Button>
            </Space.Compact>
          </span>
        </Tooltip>
        <Button
          type="primary"
          size="middle"
          onClick={onFetchComments}
          loading={fetching}
          disabled={commentBusy}
          icon={<ReloadOutlined />}
        >
          抓取评论
        </Button>
      </Space>

      <Space size={8} wrap>
        {selectedRowKeysCount > 0 && (
          <Button size="small" danger icon={<DeleteOutlined />} onClick={onBatchDelete}>
            批量删除 ({selectedRowKeysCount})
          </Button>
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {totalComments} 条评论
        </Text>
        {Array.from(accountStats.entries()).map(([name, count]) => (
          <Tag key={name} style={{ margin: 0, fontSize: 11, ...semanticTagStyle("default") }}>
            {name.length > 20 ? name.slice(0, 8) + "..." : name}: {count}
          </Tag>
        ))}
      </Space>
    </div>
  );
}
