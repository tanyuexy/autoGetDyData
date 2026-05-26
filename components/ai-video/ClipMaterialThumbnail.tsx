"use client";

import { Tooltip } from "antd";
import { PlayCircleOutlined, SoundOutlined } from "@ant-design/icons";
import { ClipVideoThumbnail } from "@/components/ai-video/ClipVideoThumbnail";
import { resolveMediaUrl } from "@/lib/ai-video/media";
import type { ClipGenerationMaterial } from "@/lib/ai-video/clipMaterials";

const THUMB_SIZE = 52;
const BADGE_LABELS = new Set(["首帧", "尾帧"]);

function MaterialLabelBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: "1px 4px",
        background: "rgba(0, 0, 0, 0.62)",
        color: "#fff",
        fontSize: 10,
        lineHeight: "14px",
        textAlign: "center",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        zIndex: 2,
      }}
    >
      {label}
    </span>
  );
}

export function ClipMaterialThumbnail({
  material,
  onClick,
}: {
  material: ClipGenerationMaterial;
  onClick: () => void;
}) {
  const tooltipTitle = `${material.label} · ${material.name}`;
  const showBadge = BADGE_LABELS.has(material.label);

  if (material.kind === "video") {
    return (
      <ClipVideoThumbnail
        videoUrl={material.url}
        width={THUMB_SIZE}
        height={THUMB_SIZE}
        tooltipTitle={tooltipTitle}
        onClick={onClick}
      />
    );
  }

  if (material.kind === "image") {
    return (
      <Tooltip title={tooltipTitle}>
        <button
          type="button"
          aria-label={`预览${material.label}`}
          onClick={onClick}
          style={{
            position: "relative",
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            padding: 0,
            border: "1px solid var(--vol-hairline)",
            borderRadius: 6,
            overflow: "hidden",
            cursor: "pointer",
            background: "#111",
            flexShrink: 0,
          }}
        >
          <img
            src={resolveMediaUrl(material.url)}
            alt={material.name}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          {showBadge ? <MaterialLabelBadge label={material.label} /> : null}
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={`${tooltipTitle}（点击播放）`}>
      <button
        type="button"
        aria-label={`播放${material.label}`}
        onClick={onClick}
        style={{
          position: "relative",
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          padding: 0,
          border: "1px solid var(--vol-hairline)",
          borderRadius: 6,
          overflow: "hidden",
          cursor: "pointer",
          background: "#111",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
          }}
        >
          <SoundOutlined />
        </span>
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.28)",
            fontSize: 18,
          }}
        >
          <PlayCircleOutlined />
        </span>
        {showBadge ? <MaterialLabelBadge label={material.label} /> : null}
      </button>
    </Tooltip>
  );
}
