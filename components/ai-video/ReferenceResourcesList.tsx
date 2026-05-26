"use client";

import { Button, Tooltip, Typography } from "antd";
import { DeleteOutlined, HolderOutlined, PaperClipOutlined } from "@ant-design/icons";
import { VideoFrameThumbnail } from "@/components/ai-video/ClipVideoThumbnail";
import { formatFileSize, getReferenceLabel } from "@/lib/ai-video/clipUtils";
import { framePreviewStyle } from "@/lib/ai-video/styles";
import type { ReferenceResource } from "@/lib/ai-video/types";

export interface ReferenceResourcesListProps {
  referenceResources: ReferenceResource[];
  draggingReferenceId: string | null;
  dragOverReferenceId: string | null;
  onDragStart: (event: React.DragEvent, id: string) => void;
  onDragOver: (event: React.DragEvent, id: string) => void;
  onDragLeave: (event: React.DragEvent, id: string) => void;
  onDrop: (event: React.DragEvent, targetId: string) => void;
  onDragEnd: () => void;
  onInsertToken: (resource: ReferenceResource) => void;
  onRemove: (id: string) => void;
}

export function ReferenceResourcesList({
  referenceResources,
  draggingReferenceId,
  dragOverReferenceId,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onInsertToken,
  onRemove,
}: ReferenceResourcesListProps) {
  if (!referenceResources.length) return null;
  const canDrag = referenceResources.length > 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {referenceResources.map((resource, index) => {
        const label = getReferenceLabel(referenceResources, resource);
        const token = `@${label}`;
        const isDragging = draggingReferenceId === resource.id;
        const isDragOver = dragOverReferenceId === resource.id;
        return (
          <div
            key={resource.id}
            onDragOver={(event) => onDragOver(event, resource.id)}
            onDragLeave={(event) => onDragLeave(event, resource.id)}
            onDrop={(event) => onDrop(event, resource.id)}
            style={{
              ...framePreviewStyle,
              maxWidth: 520,
              opacity: isDragging ? 0.55 : 1,
              borderColor: isDragOver ? "var(--ic-fin-orange)" : "var(--vol-hairline)",
              boxShadow: isDragOver ? "0 0 0 1px var(--ic-fin-orange)" : undefined,
            }}
          >
            <Tooltip title={canDrag ? "按住左侧图标拖动调整顺序" : undefined}>
              <span
                draggable={canDrag}
                onDragStart={(event) => {
                  if (!canDrag) {
                    event.preventDefault();
                    return;
                  }
                  event.stopPropagation();
                  onDragStart(event, resource.id);
                }}
                onDragEnd={(event) => {
                  event.stopPropagation();
                  onDragEnd();
                }}
                aria-label={canDrag ? "拖动调整顺序" : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  color: "var(--vol-mute)",
                  fontSize: 14,
                  flexShrink: 0,
                  cursor: canDrag ? (isDragging ? "grabbing" : "grab") : "default",
                  touchAction: "none",
                }}
              >
                <HolderOutlined />
              </span>
            </Tooltip>
            <Typography.Text type="secondary" style={{ width: 18, flexShrink: 0, fontSize: 12 }}>
              {index + 1}
            </Typography.Text>
            {resource.kind === "image" ? (
              <img
                draggable={false}
                src={resource.url}
                alt={resource.name}
                style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
              />
            ) : resource.kind === "video" ? (
              <VideoFrameThumbnail videoUrl={resource.url} width={36} height={36} borderRadius={4} />
            ) : (
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 4,
                  background: "#111",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: 16,
                }}
              >
                <PaperClipOutlined />
              </div>
            )}
            <Button size="small" type="link" draggable={false} onClick={() => onInsertToken(resource)}>
              {token}
            </Button>
            <Typography.Text type="secondary" style={{ flex: 1, minWidth: 0, fontSize: 12 }} ellipsis>
              {resource.name}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
              {formatFileSize(resource.size)}
            </Typography.Text>
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              aria-label={`删除${label}`}
              draggable={false}
              onClick={() => onRemove(resource.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
