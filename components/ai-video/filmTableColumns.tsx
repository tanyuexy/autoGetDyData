"use client";

import { Button, Modal, Space, Tooltip, Typography } from "antd";
import type { TableProps } from "antd";
import type { AiVideoComposedFilm } from "@/types";
import { ClipVideoThumbnail } from "@/components/ai-video/ClipVideoThumbnail";
import { resolveMediaUrl } from "@/lib/ai-video/media";
import type { ClipItem } from "@/lib/ai-video/types";

export interface BuildFilmTableColumnsDeps {
  canDeleteMaterials: boolean;
  clipById: Map<string, ClipItem>;
  onPreviewFilm: (film: AiVideoComposedFilm) => void;
  onPreviewClip: (clip: ClipItem) => void;
  onDeleteFilm: (film: AiVideoComposedFilm) => Promise<void>;
}

export function buildFilmTableColumns(
  deps: BuildFilmTableColumnsDeps
): NonNullable<TableProps<AiVideoComposedFilm>["columns"]> {
  const { canDeleteMaterials, clipById, onPreviewFilm, onPreviewClip, onDeleteFilm } = deps;

  return [
    {
      title: "预览",
      key: "preview",
      width: 108,
      align: "center" as const,
      render: (_: unknown, record: AiVideoComposedFilm) => (
        <ClipVideoThumbnail width={96} height={64} videoUrl={record.videoUrl} onClick={() => onPreviewFilm(record)} />
      ),
    },
    {
      title: "用户",
      dataIndex: "username",
      width: 88,
      align: "center" as const,
      render: (_: unknown, record: AiVideoComposedFilm) => (
        <Typography.Text style={{ fontSize: 12 }}>{record.username?.trim() || "—"}</Typography.Text>
      ),
    },
    {
      title: "使用片段",
      key: "segments",
      width: 360,
      align: "center" as const,
      render: (_: unknown, record: AiVideoComposedFilm) => (
        <Space size={10} wrap style={{ width: "100%", justifyContent: "center" }}>
          {record.segments.map((segment) => {
            const clip = clipById.get(segment.id);
            const prompt = String(clip?.prompt || "").trim();
            const tooltipContent = (
              <Space orientation="vertical" size={4} style={{ maxWidth: 360 }}>
                <Typography.Text style={{ color: "#fff", fontSize: 12 }}>
                  {segment.order}. {segment.name}
                </Typography.Text>
                {prompt ? (
                  <Typography.Text style={{ color: "rgba(255,255,255,0.88)", fontSize: 12, whiteSpace: "pre-wrap" }}>
                    {prompt}
                  </Typography.Text>
                ) : null}
              </Space>
            );

            return (
              <Tooltip key={`${record.id}-${segment.id}-${segment.order}`} title={tooltipContent} styles={{ root: { maxWidth: 420 } }}>
                {clip?.videoUrl ? (
                  <ClipVideoThumbnail
                    videoUrl={clip.videoUrl}
                    coverUrl={clip.coverUrl}
                    width={88}
                    height={60}
                    showPlayIcon={false}
                    orderBadge={segment.order}
                    tooltipTitle={null}
                    onClick={() => onPreviewClip(clip)}
                  />
                ) : (
                  <div
                    style={{
                      position: "relative",
                      width: 88,
                      height: 60,
                      borderRadius: 6,
                      border: "1px dashed var(--vol-hairline)",
                      background: "var(--vol-canvas)",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 4,
                        left: 4,
                        minWidth: 18,
                        height: 18,
                        paddingInline: 4,
                        borderRadius: 999,
                        background: "rgba(0, 0, 0, 0.55)",
                        color: "#fff",
                        fontSize: 11,
                        lineHeight: "18px",
                        textAlign: "center",
                        fontWeight: 600,
                      }}
                    >
                      {segment.order}
                    </span>
                  </div>
                )}
              </Tooltip>
            );
          })}
        </Space>
      ),
    },
    {
      title: "背景音乐",
      dataIndex: "backgroundMusic",
      width: 200,
      align: "center" as const,
      render: (value: string | null | undefined) =>
        value ? (
          <Typography.Text style={{ fontSize: 12, display: "block", textAlign: "center" }} ellipsis={{ tooltip: String(value) }}>
            {String(value)}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            —
          </Typography.Text>
        ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 168,
      align: "center" as const,
      render: (value: string) => (
        <Typography.Text style={{ fontSize: 12 }}>
          {value ? new Date(String(value)).toLocaleString("zh-CN") : "—"}
        </Typography.Text>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 152,
      fixed: "right" as const,
      align: "center" as const,
      render: (_: unknown, record: AiVideoComposedFilm) => (
        <Space size={8} wrap style={{ justifyContent: "center", width: "100%" }}>
          <Button size="small" type="link" style={{ padding: 0 }} onClick={() => onPreviewFilm(record)}>
            预览
          </Button>
          <Button size="small" type="link" style={{ padding: 0 }} href={resolveMediaUrl(record.videoUrl)} target="_blank">
            打开
          </Button>
          {canDeleteMaterials ? (
            <Button
              size="small"
              type="link"
              danger
              style={{ padding: 0 }}
              onClick={() => {
                Modal.confirm({
                  title: "删除这条成片记录？",
                  content: "仅删除列表记录，不会删除磁盘上的视频文件。",
                  okText: "删除",
                  cancelText: "取消",
                  onOk: () => onDeleteFilm(record),
                });
              }}
            >
              删除
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];
}
