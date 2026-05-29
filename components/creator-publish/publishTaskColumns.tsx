import { Button, Popconfirm, Popover, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import {
  MULTILINE_TEXT_STYLE,
  STATUS_MAP,
  TASK_TABLE_OP_LINK_STYLE,
} from "@/lib/creator-publish/constants";
import {
  getPublishTaskColumnSortOrder,
  getPublishTaskScheduleSortValue,
  getPublishTaskUpdatedAtSortValue,
  type PublishTaskTableSorter,
} from "@/lib/creator-publish/scheduleUtils";
import type { PublishTask, TaskStatus } from "@/lib/creator-publish/types";
import { antdTagPresetStyle } from "@/lib/semanticTagStyles";

const { Text } = Typography;

function renderMultilineText(value?: string, lines = 2, opts?: { showNativeTitle?: boolean }) {
  if (!value) return "-";
  const showNativeTitle = opts?.showNativeTitle !== false;
  return (
    <div
      title={showNativeTitle ? value : undefined}
      style={lines === 2 ? MULTILINE_TEXT_STYLE : { ...MULTILINE_TEXT_STYLE, WebkitLineClamp: lines }}
    >
      {value}
    </div>
  );
}

function renderHoverPreview(value?: string, placeholder = "-") {
  if (!value) return placeholder;
  return (
    <Popover
      trigger="hover"
      placement="topLeft"
      styles={{ root: { maxWidth: 420 } }}
      content={
        <div
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxWidth: 380,
            lineHeight: 1.6,
          }}
        >
          {value}
        </div>
      }
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 22,
          color: "#2563eb",
          cursor: "pointer",
          whiteSpace: "nowrap",
          fontSize: 12,
        }}
      >
        {placeholder}
      </span>
    </Popover>
  );
}

export type PublishTaskColumnsDeps = {
  tableSorter: PublishTaskTableSorter | null;
  runningTasks: { taskId: string }[];
  isNamespaceBusy: (namespace: string) => boolean;
  selectTaskLog: (taskId: string, isDone: boolean) => void | Promise<void>;
  taskHasMaterial: (task: PublishTask) => boolean;
  openMaterialPreview: (task: PublishTask) => void;
  handleRetryTask: (task: PublishTask) => void;
  openEditTask: (task: PublishTask) => void;
  handleRunNow: (task: PublishTask) => void;
  handleDeleteTask: (task: PublishTask) => void;
  copyTaskId: (id: string) => void | Promise<void>;
};

function renderCopyableTaskId(id: string | undefined, copyTaskId: (id: string) => void | Promise<void>) {
  if (!id) return "-";
  return (
    <Tooltip title={`${id}（点击复制）`}>
      <Text
        code
        style={{
          fontSize: 11,
          cursor: "copy",
          maxWidth: 116,
          display: "inline-block",
          margin: 0,
        }}
        ellipsis
        onClick={() => void copyTaskId(id)}
      >
        {id}
      </Text>
    </Tooltip>
  );
}

export function buildPublishTaskColumns(deps: PublishTaskColumnsDeps): ColumnsType<PublishTask> {
  const {
    tableSorter,
    runningTasks,
    isNamespaceBusy,
    selectTaskLog,
    taskHasMaterial,
    openMaterialPreview,
    handleRetryTask,
    openEditTask,
    handleRunNow,
    handleDeleteTask,
    copyTaskId,
  } = deps;

  return [
    {
      title: "任务ID",
      dataIndex: "id",
      align: "center" as const,
      width: 128,
      render: (id: string) => renderCopyableTaskId(id, copyTaskId),
    },
    {
      title: "账号",
      dataIndex: "accountName",
      align: "center" as const,
      width: 150,
      render: (value: string) => renderMultilineText(value, 2),
    },
    {
      title: "类型",
      align: "center" as const,
      width: 56,
      render: (_: unknown, r: PublishTask) => {
        const label = r.payload.type === "video" ? "视频" : "图文";
        if (!taskHasMaterial(r)) return label;
        return (
          <Tooltip title="点击预览素材">
            <span
              style={{
                color: "#2563eb",
                cursor: "pointer",
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
              onClick={() => openMaterialPreview(r)}
            >
              {label}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: "标题",
      width: 78,
      align: "center" as const,
      render: (_: unknown, r: PublishTask) => {
        const title = String(r.payload.title ?? "").trim();
        if (!title) return "-";
        return renderHoverPreview(title, "查看标题");
      },
    },
    {
      title: "正文",
      width: 78,
      align: "center" as const,
      render: (_: unknown, r: PublishTask) => renderHoverPreview(r.payload.description || "", "查看正文"),
    },
    {
      title: "定时",
      key: "scheduleAt",
      align: "center" as const,
      width: 112,
      sorter: (a: PublishTask, b: PublishTask) =>
        getPublishTaskScheduleSortValue(a) - getPublishTaskScheduleSortValue(b),
      sortOrder: getPublishTaskColumnSortOrder("scheduleAt", tableSorter),
      showSorterTooltip: { title: "按定时排序：升序为时间从早到晚，「立即」在最前" },
      render: (_: unknown, r: PublishTask) =>
        r.payload.scheduleAt ? dayjs(r.payload.scheduleAt).format("MM-DD HH:mm") : "立即",
    },
    {
      title: "挂车链接",
      width: 84,
      align: "center" as const,
      render: (_: unknown, r: PublishTask) => {
        const link = r.payload.productLink || "";
        if (!link) return "-";
        return (
          <Popover
            trigger="hover"
            placement="topLeft"
            styles={{ root: { maxWidth: 420 } }}
            content={
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  maxWidth: 380,
                  lineHeight: 1.6,
                }}
              >
                <a href={link} target="_blank" rel="noreferrer">
                  {link}
                </a>
              </div>
            }
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 22,
                color: "#2563eb",
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontSize: 12,
              }}
            >
              查看链接
            </span>
          </Popover>
        );
      },
    },
    {
      title: "AI内容",
      width: 70,
      align: "center" as const,
      render: (_: unknown, r: PublishTask) => (
        <Tag
          style={
            r.payload.isAiContent
              ? {
                  marginInlineEnd: 0,
                  background: "#111111",
                  color: "#ffffff",
                  borderColor: "#111111",
                }
              : {
                  marginInlineEnd: 0,
                  background: "#ebe7e1",
                  color: "#626260",
                  borderColor: "#d3cec6",
                }
          }
        >
          {r.payload.isAiContent ? "是" : "否"}
        </Tag>
      ),
    },
    {
      title: "广审批文号",
      width: 120,
      render: (_: unknown, r: PublishTask) => renderMultilineText(r.payload.approvalNumber || "", 2),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 72,
      align: "center" as const,
      render: (s: TaskStatus) => {
        const v = STATUS_MAP[s];
        return <Tag style={antdTagPresetStyle(v.color)}>{v.text}</Tag>;
      },
    },
    {
      title: "飞书行",
      dataIndex: "feishuRowNumber",
      width: 72,
      align: "center" as const,
      render: (v?: number) => (Number.isFinite(v) ? String(v) : "-"),
    },
    {
      title: "错误",
      align: "left" as const,
      onCell: () => ({
        style: {
          minWidth: 180,
        },
      }),
      render: (_: unknown, r: PublishTask) =>
        r.lastError ? (
          <Tooltip
            title={r.lastError}
            placement="topLeft"
            mouseEnterDelay={0.15}
            styles={{
              root: { maxWidth: 480 },
              container: {
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
                lineHeight: 1.5,
                maxHeight: "min(60vh, 360px)",
                overflowX: "hidden",
                overflowY: "auto",
              },
            }}
          >
            <span style={{ display: "block", width: "100%", cursor: "default" }}>
              <Typography.Text type="danger">
                {renderMultilineText(r.lastError, 2, { showNativeTitle: false })}
              </Typography.Text>
            </span>
          </Tooltip>
        ) : null,
    },
    {
      title: "更新时间",
      key: "displayUpdatedAt",
      width: 120,
      align: "center" as const,
      sorter: (a: PublishTask, b: PublishTask) =>
        getPublishTaskUpdatedAtSortValue(a) - getPublishTaskUpdatedAtSortValue(b),
      sortOrder: getPublishTaskColumnSortOrder("displayUpdatedAt", tableSorter),
      sortDirections: ["descend", "ascend"],
      showSorterTooltip: false,
      render: (_: unknown, r: PublishTask) =>
        dayjs(r.displayUpdatedAt ?? r.updatedAt ?? r.createdAt).format("MM-DD HH:mm"),
    },
    {
      title: "操作",
      width: 132,
      align: "center" as const,
      render: (_: unknown, r: PublishTask) => (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            columnGap: 2,
            rowGap: 2,
            justifyItems: "center",
          }}
        >
          <Button
            size="small"
            type="link"
            style={TASK_TABLE_OP_LINK_STYLE}
            disabled={!r.taskId}
            onClick={() => {
              if (r.taskId) {
                const stillRunning = runningTasks.some((t) => t.taskId === r.taskId);
                selectTaskLog(r.taskId, !stillRunning && (r.status === "success" || r.status === "failed"));
              }
            }}
          >
            日志
          </Button>
          <Button
            size="small"
            type="link"
            style={TASK_TABLE_OP_LINK_STYLE}
            disabled={
              (r.status !== "failed" && r.status !== "cancelled" && r.status !== "success") ||
              isNamespaceBusy("creator-publish")
            }
            onClick={() => handleRetryTask(r)}
          >
            重试
          </Button>
          <Button
            size="small"
            type="link"
            style={TASK_TABLE_OP_LINK_STYLE}
            disabled={r.status === "running"}
            onClick={() => openEditTask(r)}
          >
            编辑
          </Button>
          {r.status === "pending" && (
            <Button
              size="small"
              type="link"
              style={TASK_TABLE_OP_LINK_STYLE}
              onClick={() => handleRunNow(r)}
            >
              执行
            </Button>
          )}
          <Popconfirm
            title="确认删除任务？"
            description={
              <div style={{ color: "var(--vol-body)" }}>
                将删除任务：<Text code>{r.id}</Text>
                <br />
                <Text type="secondary">账号：{r.accountName}</Text>
              </div>
            }
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            placement="top"
            onConfirm={() => handleDeleteTask(r)}
          >
            <Button size="small" type="link" danger style={TASK_TABLE_OP_LINK_STYLE}>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];
}
