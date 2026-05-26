import { Button, Popconfirm, Popover, Select, Space, Table, Typography } from "antd";
import { MultiSelectWithTooltip } from "@/components/MultiSelectWithTooltip";
import { useTableBodyScrollY } from "@/hooks/useTableBodyScrollY";
import type { ColumnsType } from "antd/es/table";
import {
  ON_ROW_STYLE,
  TASK_STATUS_SELECT_OPTIONS,
  TASK_TYPE_OPTIONS,
} from "@/lib/creator-publish/constants";
import type { PublishTask, TaskStatus, TaskType } from "@/lib/creator-publish/types";
import { FEISHU_AI_PROVIDER_OPTIONS } from "@/lib/feishuAiProvider";
import type { FeishuAiProvider } from "@/types";

const { Text } = Typography;

type PublishTaskListSectionProps = {
  taskTypeFilters: TaskType[];
  setTaskTypeFilters: (v: TaskType[]) => void;
  taskStatusFilters: TaskStatus[];
  setTaskStatusFilters: (v: TaskStatus[]) => void;
  taskShopFilters: string[];
  setTaskShopFilters: (v: string[]) => void;
  taskShopSelectOptions: { label: string; value: string }[];
  selectedRowKeys: React.Key[];
  terminableSelectedRowKeys: string[];
  onStartTasks: () => void;
  onKillSelected: () => void;
  onBatchDelete: () => void;
  feishuAiProvider: FeishuAiProvider;
  onFeishuAiProviderChange: (v: FeishuAiProvider) => void;
  onGenerateFeishuAiContent: () => void;
  generatingFeishuAi: boolean;
  isNamespaceBusy: (namespace: string) => boolean;
  onImportFromFeishu: () => void;
  importing: boolean;
  onRefreshTasks: () => void;
  loadingTasks: boolean;
  filteredTasks: PublishTask[];
  columns: ColumnsType<PublishTask>;
  setScheduleColumnSortOrder: (v: "ascend" | "descend" | null) => void;
  rowSelection: { selectedRowKeys: React.Key[]; onChange: (keys: React.Key[]) => void };
};

export function PublishTaskListSection({
  taskTypeFilters,
  setTaskTypeFilters,
  taskStatusFilters,
  setTaskStatusFilters,
  taskShopFilters,
  setTaskShopFilters,
  taskShopSelectOptions,
  selectedRowKeys,
  terminableSelectedRowKeys,
  onStartTasks,
  onKillSelected,
  onBatchDelete,
  feishuAiProvider,
  onFeishuAiProviderChange,
  onGenerateFeishuAiContent,
  generatingFeishuAi,
  isNamespaceBusy,
  onImportFromFeishu,
  importing,
  onRefreshTasks,
  loadingTasks,
  filteredTasks,
  columns,
  setScheduleColumnSortOrder,
  rowSelection,
}: PublishTaskListSectionProps) {
  const handleRow = () => ({ style: ON_ROW_STYLE });
  const { containerRef, scrollY } = useTableBodyScrollY();

  return (
    <div className="app-page-fill">
      <div
        style={{
          marginBottom: 8,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Space size={8} wrap>
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            value={taskTypeFilters}
            onChange={setTaskTypeFilters}
            options={TASK_TYPE_OPTIONS}
            style={{ minWidth: 120, maxWidth: 200 }}
            size="small"
            popupMatchSelectWidth={false}
            placeholder="全部类型"
            aria-label="按类型筛选任务"
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            value={taskStatusFilters}
            onChange={setTaskStatusFilters}
            options={TASK_STATUS_SELECT_OPTIONS}
            style={{ minWidth: 160, maxWidth: 320 }}
            size="small"
            popupMatchSelectWidth={false}
            placeholder="全部状态"
            aria-label="按状态筛选任务"
          />
          <MultiSelectWithTooltip
            allowClear
            maxTagCount="responsive"
            value={taskShopFilters}
            onChange={setTaskShopFilters}
            options={taskShopSelectOptions}
            style={{ minWidth: 180, maxWidth: 320 }}
            size="small"
            showSearch
            optionFilterProp="label"
            popupMatchSelectWidth={false}
            placeholder="全部店铺"
            aria-label="按店铺筛选任务"
          />
        </Space>
        <Space size={4} wrap>
          <Button
            type="primary"
            size="small"
            disabled={selectedRowKeys.length === 0}
            onClick={onStartTasks}
          >
            启动任务 ({selectedRowKeys.length})
          </Button>
          <Popconfirm
            title="确认终止选中任务？"
            description={`将终止 ${terminableSelectedRowKeys.length} 个选中的队列中/执行中任务，其他状态会被忽略`}
            okText="终止"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={onKillSelected}
          >
            <Button danger size="small" disabled={terminableSelectedRowKeys.length === 0}>
              终止选中 ({terminableSelectedRowKeys.length})
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确认批量删除？"
            description={`将删除 ${selectedRowKeys.length} 个任务，此操作不可恢复`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={onBatchDelete}
          >
            <Button danger size="small" disabled={selectedRowKeys.length === 0}>
              删除选中 ({selectedRowKeys.length})
            </Button>
          </Popconfirm>
          <Popover
            trigger="hover"
            placement="bottomRight"
            content={
              <Space orientation="vertical" size={8} style={{ minWidth: 200 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  AI 模型选择
                </Text>
                <Select
                  value={feishuAiProvider}
                  onChange={onFeishuAiProviderChange}
                  style={{ width: "100%" }}
                  options={FEISHU_AI_PROVIDER_OPTIONS}
                />
              </Space>
            }
          >
            <Button
              type="primary"
              size="small"
              onClick={onGenerateFeishuAiContent}
              loading={generatingFeishuAi}
              disabled={isNamespaceBusy("creator-publish")}
            >
              AI生成正文
            </Button>
          </Popover>
          <Button
            type="primary"
            size="small"
            onClick={onImportFromFeishu}
            loading={importing}
            disabled={isNamespaceBusy("creator-publish")}
          >
            从飞书导入任务
          </Button>
          <Button onClick={onRefreshTasks} loading={loadingTasks} size="small">
            刷新任务
          </Button>
        </Space>
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }}>
        <Table
          rowKey="id"
          size="small"
          bordered
          loading={loadingTasks}
          dataSource={filteredTasks}
          columns={columns}
          tableLayout="fixed"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 1388, y: scrollY }}
          onChange={(_pagination, _filters, sorter, extra) => {
            if (extra.action !== "sort") return;
            const s = Array.isArray(sorter) ? sorter[0] : sorter;
            setScheduleColumnSortOrder((s?.order ?? null) as "ascend" | "descend" | null);
          }}
          rowSelection={rowSelection}
          style={{ width: "100%" }}
          onRow={handleRow}
        />
      </div>
    </div>
  );
}
