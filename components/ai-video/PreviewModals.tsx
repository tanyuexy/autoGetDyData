"use client";

import { Modal, Space, Typography } from "antd";
import type { AiVideoComposedFilm } from "@/types";
import { resolveMediaUrl } from "@/lib/ai-video/media";
import type { ClipItem } from "@/lib/ai-video/types";

export interface PreviewModalsProps {
  previewFilm: AiVideoComposedFilm | null;
  previewClip: ClipItem | null;
  onCloseFilm: () => void;
  onCloseClip: () => void;
}

export function PreviewModals({ previewFilm, previewClip, onCloseFilm, onCloseClip }: PreviewModalsProps) {
  return (
    <>
      <Modal
        open={Boolean(previewFilm)}
        destroyOnHidden
        centered
        title={previewFilm ? `成片预览 · ${previewFilm.mode === "random" ? "随机混剪" : "顺序合成"}` : "成片预览"}
        footer={null}
        width={760}
        onCancel={onCloseFilm}
      >
        {previewFilm?.videoUrl ? (
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <video
              key={previewFilm.id}
              controls
              autoPlay
              src={resolveMediaUrl(previewFilm.videoUrl)}
              style={{
                width: "100%",
                maxHeight: "60vh",
                borderRadius: 8,
                background: "#000",
              }}
            />
            <Space orientation="vertical" size={4} style={{ width: "100%" }}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                使用片段
              </Typography.Text>
              {previewFilm.segments.map((segment) => (
                <Typography.Text key={`${previewFilm.id}-${segment.id}`} style={{ fontSize: 12 }}>
                  {segment.order}. {segment.name}
                </Typography.Text>
              ))}
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              背景音乐：{previewFilm.backgroundMusic || "—"}
            </Typography.Text>
          </Space>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(previewClip)}
        destroyOnHidden
        centered
        title={previewClip?.name || "视频预览"}
        footer={null}
        width={760}
        onCancel={onCloseClip}
      >
        {previewClip?.videoUrl ? (
          <video
            key={previewClip.id}
            controls
            autoPlay
            src={resolveMediaUrl(previewClip.videoUrl)}
            style={{
              width: "100%",
              maxHeight: "70vh",
              borderRadius: 8,
              background: "#000",
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}
