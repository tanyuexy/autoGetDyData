"use client";

import { Space, Typography } from "antd";
import { ClipMaterialThumbnail } from "@/components/ai-video/ClipMaterialThumbnail";
import { getClipGenerationMaterials, type ClipGenerationMaterial } from "@/lib/ai-video/clipMaterials";
import type { ClipItem } from "@/lib/ai-video/types";

export function ClipMaterialThumbnails({
  clip,
  onPreviewMaterial,
}: {
  clip: ClipItem;
  onPreviewMaterial: (material: ClipGenerationMaterial, clip: ClipItem) => void;
}) {
  const materials = getClipGenerationMaterials(clip);

  if (!materials.length) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        —
      </Typography.Text>
    );
  }

  return (
    <Space size={8} wrap style={{ justifyContent: "center", maxWidth: 280 }}>
      {materials.map((material) => (
        <ClipMaterialThumbnail
          key={material.id}
          material={material}
          onClick={() => onPreviewMaterial(material, clip)}
        />
      ))}
    </Space>
  );
}
