"use client";

import { Button, Space, Tag, Tooltip, Typography } from "antd";
import type { TableProps } from "antd";
import { DownloadOutlined, DeleteOutlined, RedoOutlined, ReloadOutlined } from "@ant-design/icons";
import { ClipMaterialThumbnails } from "@/components/ai-video/ClipMaterialThumbnails";
import { ClipVideoThumbnail } from "@/components/ai-video/ClipVideoThumbnail";
import type { ClipGenerationMaterial } from "@/lib/ai-video/clipMaterials";
import { antdTagPresetStyle } from "@/lib/semanticTagStyles";
import {
  formatClipModelLabel,
  formatClipStatusLabel,
  getStatusPreset,
  isClipCompleted,
  isFinished,
} from "@/lib/ai-video/clipUtils";
import { resolveClipDisplayName } from "@/lib/ai-video/clipNameGenerator";
import { formatTokenUsageLabel, formatTokenUsageTooltipLines, getTokenUsageSortValue } from "@/lib/ai-video/tokenUsage";
import type { ClipItem } from "@/lib/ai-video/types";

export interface BuildClipTableColumnsDeps {
  canDeleteMaterials: boolean;
  onCopyPrompt: (text: string) => void;
  onPreviewClip: (clip: ClipItem) => void;
  onPreviewMaterial: (material: ClipGenerationMaterial, clip: ClipItem) => void;
  onPollTask: (clipId: string, taskId: string) => void;
  onDownloadClip: (clip: ClipItem) => void;
  onRestoreFormFromClip: (clip: ClipItem) => void;
  onDeleteClip: (clip: ClipItem) => void;
}

export function buildClipTableColumns(
  deps: BuildClipTableColumnsDeps
): NonNullable<TableProps<ClipItem>["columns"]> {
  const {
    canDeleteMaterials,
    onCopyPrompt,
    onPreviewClip,
    onPreviewMaterial,
    onPollTask,
    onDownloadClip,
    onRestoreFormFromClip,
    onDeleteClip,
  } = deps;

  return [
    {
      title: "用户",
      dataIndex: "username",
      width: 88,
      align: "center",
      render: (value: string | null | undefined) => (
        <Typography.Text style={{ fontSize: 12 }}>{value?.trim() || "—"}</Typography.Text>
      ),
    },
    {
      title: "Token",
      key: "tokenUsage",
      width: 88,
      align: "center",
      sorter: (a, b) => getTokenUsageSortValue(a.tokenUsage) - getTokenUsageSortValue(b.tokenUsage),
      sortDirections: ["descend", "ascend"],
      render: (_, record) => {
        const label = formatTokenUsageLabel(record.tokenUsage);
        const usage = record.tokenUsage;
        const tooltipLines = formatTokenUsageTooltipLines(usage);
        const tooltip = tooltipLines.length ? (
          <span style={{ whiteSpace: "pre-wrap" }}>{tooltipLines.join("\n")}</span>
        ) : null;

        return tooltip ? (
          <Tooltip title={tooltip}>
            <Typography.Text style={{ fontSize: 12 }}>{label}</Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type={label === "—" ? "secondary" : undefined} style={{ fontSize: 12 }}>
            {label}
          </Typography.Text>
        );
      },
    },
    {
      title: "片段",
      dataIndex: "name",
      width: 132,
      align: "center",
      render: (_, record) => {
        const meta = `${record.ratio} · ${record.resolution} · ${record.duration}s`;
        const prompt = String(record.prompt || "").trim();
        const rawName = String(record.name || "").trim();
        const displayName = resolveClipDisplayName(rawName, prompt);
        const tooltipContent = `${displayName || "—"}\n${meta}`;

        return (
          <Tooltip
            title={<span style={{ whiteSpace: "pre-wrap" }}>{tooltipContent}</span>}
            styles={{ root: { maxWidth: 420 } }}
          >
            <Space
              orientation="vertical"
              size={2}
              style={{ width: "100%", maxWidth: 116, margin: "0 auto" }}
            >
              <Typography.Text strong ellipsis style={{ width: "100%", fontSize: 12 }}>
                {displayName}
              </Typography.Text>
              <Typography.Text type="secondary" ellipsis style={{ width: "100%", fontSize: 11 }}>
                {meta}
              </Typography.Text>
            </Space>
          </Tooltip>
        );
      },
    },
    {
      title: "素材",
      key: "materials",
      width: 280,
      align: "center",
      render: (_, record) => (
        <ClipMaterialThumbnails clip={record} onPreviewMaterial={onPreviewMaterial} />
      ),
    },
    {
      title: "标签",
      dataIndex: "tag",
      width: 100,
      align: "center",
      render: (_, record) => {
        const tag = String(record.tag || "").trim();
        return tag ? (
          <Tag variant="filled" color="cyan" style={{ margin: 0 }}>
            {tag}
          </Tag>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            —
          </Typography.Text>
        );
      },
    },
    {
      title: "混剪分组",
      dataIndex: "composeGroup",
      width: 120,
      align: "center",
      render: (_, record) => {
        const group = String(record.composeGroup || "").trim();
        return group ? (
          <Tag variant="filled" color="purple" style={{ margin: 0 }}>
            {group}
          </Tag>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            —
          </Typography.Text>
        );
      },
    },
    {
      title: "模型",
      dataIndex: "model",
      width: 148,
      align: "center",
      render: (value) => {
        const raw = String(value || "").trim();
        const label = formatClipModelLabel(raw);
        if (label === "—") {
          return (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              —
            </Typography.Text>
          );
        }
        const showIdTooltip = raw && raw !== label && raw !== "manual";
        const text = (
          <Typography.Text style={{ fontSize: 12, whiteSpace: "nowrap" }}>
            {label}
          </Typography.Text>
        );
        return showIdTooltip ? (
          <Tooltip title={raw} styles={{ root: { maxWidth: 420 } }}>
            {text}
          </Tooltip>
        ) : (
          text
        );
      },
    },
    {
      title: "提示词",
      dataIndex: "prompt",
      width: 260,
      align: "center",
      render: (value) => {
        const prompt = String(value || "").trim();
        if (!prompt) {
          return (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              —
            </Typography.Text>
          );
        }
        return (
          <Tooltip
            title={
              <span style={{ whiteSpace: "pre-wrap" }}>
                {prompt}
                <br />
                （点击复制）
              </span>
            }
            styles={{ root: { maxWidth: 480 } }}
          >
            <Typography.Text
              style={{ fontSize: 12, maxWidth: 240, cursor: "copy", display: "block", textAlign: "center" }}
              ellipsis
              onClick={() => void onCopyPrompt(prompt)}
            >
              {prompt}
            </Typography.Text>
          </Tooltip>
        );
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      align: "center",
      render: (value) => {
        const status = String(value || "unknown");
        return (
          <Tag style={{ ...antdTagPresetStyle(getStatusPreset(status)), margin: 0 }}>
            {formatClipStatusLabel(status)}
          </Tag>
        );
      },
    },
    {
      title: "视频",
      dataIndex: "videoUrl",
      width: 88,
      align: "center",
      render: (_, record) =>
        record.videoUrl ? (
          <ClipVideoThumbnail
            videoUrl={record.videoUrl}
            coverUrl={record.coverUrl}
            onClick={() => onPreviewClip(record)}
          />
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            等待
          </Typography.Text>
        ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 168,
      align: "center",
      render: (value: string) => (
        <Typography.Text style={{ fontSize: 12 }}>
          {value
            ? new Date(String(value)).toLocaleString("zh-CN", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })
            : "—"}
        </Typography.Text>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 148,
      align: "center",
      render: (_, record) => {
        const canRestore = record.model !== "manual";
        const canDelete = canDeleteMaterials && isClipCompleted(record.status);

        return (
          <Space size={2} wrap style={{ justifyContent: "center" }} className="ai-video-clip-actions">
            {record.taskId && !isFinished(record.status) ? (
              <Tooltip title="刷新 Seedance 任务状态">
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  aria-label="刷新任务状态"
                  onClick={() => onPollTask(record.id, record.taskId!)}
                />
              </Tooltip>
            ) : null}
            {record.videoUrl ? (
              <Tooltip title="下载视频">
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  aria-label="下载视频"
                  onClick={() => void onDownloadClip(record)}
                />
              </Tooltip>
            ) : null}
            {canRestore ? (
              <Tooltip title="回填该片段的生成配置到上方表单">
                <Button
                  size="small"
                  icon={<RedoOutlined />}
                  aria-label="重试回填配置"
                  onClick={() => onRestoreFormFromClip(record)}
                />
              </Tooltip>
            ) : null}
            {canDeleteMaterials ? (
              <Tooltip title={canDelete ? "从列表移除" : "仅已完成状态的片段可删除"}>
                <Button
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  aria-label="删除片段"
                  disabled={!canDelete}
                  onClick={() => onDeleteClip(record)}
                />
              </Tooltip>
            ) : null}
          </Space>
        );
      },
    },
  ];
}
