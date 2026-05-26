"use client";

import { useEffect, useMemo } from "react";
import { Button, Image, Modal, Space, Tag, Typography } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import type { ClipGenerationMaterial } from "@/lib/ai-video/clipMaterials";
import { getReferenceKindLabel } from "@/lib/ai-video/clipUtils";
import { resolveMediaUrl } from "@/lib/ai-video/media";

export interface MaterialPreviewSession {
  materials: ClipGenerationMaterial[];
  index: number;
}

export interface AiVideoMaterialPreviewModalProps {
  session: MaterialPreviewSession | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

const STAGE_MIN_HEIGHT = "min(72vh, 640px)";

export function AiVideoMaterialPreviewModal({
  session,
  onClose,
  onPrev,
  onNext,
}: AiVideoMaterialPreviewModalProps) {
  const open = Boolean(session?.materials.length);
  const materials = session?.materials ?? [];
  const index = session?.index ?? 0;
  const material = materials[index] ?? null;
  const total = materials.length;
  const canNavigate = total > 1;
  const canPrev = canNavigate && index > 0;
  const canNext = canNavigate && index < total - 1;

  const modalWidth = useMemo(() => {
    if (!material) return 760;
    if (material.kind === "audio") return 520;
    return Math.min(typeof window !== "undefined" ? window.innerWidth * 0.92 : 900, 900);
  }, [material]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && canPrev) {
        event.preventDefault();
        onPrev();
      }
      if (event.key === "ArrowRight" && canNext) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, canPrev, canNext, onPrev, onNext]);

  return (
    <Modal
      open={open}
      destroyOnHidden
      centered
      footer={null}
      width={modalWidth}
      onCancel={onClose}
      title={
        material ? (
          <Space size={8} wrap>
            <Typography.Text strong>素材预览</Typography.Text>
            <Tag variant="filled" color="blue">
              {getReferenceKindLabel(material.kind)}
            </Tag>
            <Tag variant="filled">{material.label}</Tag>
            {canNavigate ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {index + 1} / {total}
              </Typography.Text>
            ) : null}
          </Space>
        ) : (
          "素材预览"
        )
      }
      styles={{
        body: { padding: 0 },
      }}
    >
      {material ? (
        <div style={{ position: "relative" }}>
          <div
            style={{
              position: "relative",
              minHeight: STAGE_MIN_HEIGHT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: canNavigate ? "16px 56px" : "16px 24px",
              background: "linear-gradient(180deg, #1a1a1e 0%, #0d0d10 100%)",
            }}
          >
            {canNavigate ? (
              <>
                <Button
                  type="text"
                  shape="circle"
                  size="large"
                  icon={<LeftOutlined />}
                  aria-label="上一份素材"
                  disabled={!canPrev}
                  onClick={onPrev}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    zIndex: 2,
                    color: "#fff",
                    background: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.18)",
                  }}
                />
                <Button
                  type="text"
                  shape="circle"
                  size="large"
                  icon={<RightOutlined />}
                  aria-label="下一份素材"
                  disabled={!canNext}
                  onClick={onNext}
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    zIndex: 2,
                    color: "#fff",
                    background: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.18)",
                  }}
                />
              </>
            ) : null}

            {material.kind === "image" ? (
              <Image
                key={material.id}
                src={resolveMediaUrl(material.url)}
                alt={material.name}
                preview={false}
                style={{
                  maxWidth: "100%",
                  maxHeight: STAGE_MIN_HEIGHT,
                  objectFit: "contain",
                  borderRadius: 8,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
                }}
              />
            ) : null}

            {material.kind === "video" ? (
              <video
                key={material.id}
                controls
                autoPlay
                src={resolveMediaUrl(material.url)}
                style={{
                  width: "100%",
                  maxWidth: "100%",
                  maxHeight: STAGE_MIN_HEIGHT,
                  borderRadius: 8,
                  background: "#000",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
                }}
              />
            ) : null}

            {material.kind === "audio" ? (
              <Space
                orientation="vertical"
                size={16}
                style={{
                  width: "100%",
                  maxWidth: 420,
                  padding: "8px 0",
                }}
              >
                <Typography.Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, textAlign: "center" }}>
                  {material.name}
                </Typography.Text>
                <audio
                  key={material.id}
                  controls
                  autoPlay
                  src={resolveMediaUrl(material.url)}
                  style={{ width: "100%" }}
                />
              </Space>
            ) : null}
          </div>

          <div
            style={{
              padding: "12px 20px 16px",
              borderTop: "1px solid var(--vol-hairline, rgba(0,0,0,0.06))",
              background: "var(--vol-surface, #fff)",
            }}
          >
            <Typography.Text strong style={{ fontSize: 13 }}>
              {material.name}
            </Typography.Text>
            {canNavigate ? (
              <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                使用 ← → 切换
              </Typography.Text>
            ) : null}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
