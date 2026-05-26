"use client";

import { Button, Space, Tag, Tooltip, Typography } from "antd";
import type { TableProps } from "antd";
import { DownloadOutlined, DeleteOutlined, RedoOutlined, ReloadOutlined } from "@ant-design/icons";
import { ClipMaterialThumbnails } from "@/components/ai-video/ClipMaterialThumbnails";
import { ClipVideoThumbnail } from "@/components/ai-video/ClipVideoThumbnail";
import type { ClipGenerationMaterial } from "@/lib/ai-video/clipMaterials";
import { antdTagPresetStyle } from "@/lib/semanticTagStyles";
import {
  formatClipStatusLabel,
  getStatusPreset,
  isClipCompleted,
  isFinished,
} from "@/lib/ai-video/clipUtils";
import type { ClipItem } from "@/lib/ai-video/types";

export interface BuildClipTableColumnsDeps {
  composeOrderMap: Map<string, number>;
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
    composeOrderMap,
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
      title: "序号",
      key: "order",
      width: 64,
      align: "center",
      render: (_, record) => {
        const composeOrder = composeOrderMap.get(record.id);
        return composeOrder ? (
          <Tag style={{ ...antdTagPresetStyle("blue"), margin: 0, minWidth: 24, textAlign: "center" }}>
            {composeOrder}
          </Tag>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            —
          </Typography.Text>
        );
      },
    },
    {
      title: "片段",
      dataIndex: "name",
      width: 240,
      align: "center",
      render: (_, record) => {
        const meta = `${record.ratio} · ${record.resolution} · ${record.duration}s`;
        const tooltipContent = `${record.name}\n${meta}`;

        return (
          <Tooltip
            title={<span style={{ whiteSpace: "pre-wrap" }}>{tooltipContent}</span>}
            styles={{ root: { maxWidth: 420 } }}
          >
            <Space orientation="vertical" size={2} style={{ maxWidth: 210, margin: "0 auto" }}>
              <Typography.Text strong ellipsis>
                {record.name}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
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
      width: 190,
      align: "center",
      render: (value) => (
        <Typography.Text style={{ fontSize: 12 }} ellipsis>
          {value}
        </Typography.Text>
      ),
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
      title: "操作",
      key: "actions",
      width: 148,
      align: "center",
      render: (_, record) => {
        const canRestore = record.model !== "manual";
        const canDelete = isClipCompleted(record.status);

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
          </Space>
        );
      },
    },
  ];
}
