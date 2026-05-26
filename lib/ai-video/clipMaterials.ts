import { getFirstImageReference, getReferenceLabel } from "@/lib/ai-video/clipUtils";
import type { ClipItem } from "@/lib/ai-video/types";
import type { ReferenceKind } from "@/lib/ai-video/types";
import type { AiVideoReferenceResource } from "@/types";

export interface ClipGenerationMaterial {
  id: string;
  name: string;
  kind: ReferenceKind;
  url: string;
  label: string;
}

function normalizeUrl(url: string) {
  return String(url || "").trim();
}

function orderReferenceResources(
  resources: AiVideoReferenceResource[],
  firstFrameRefId: string | null
) {
  if (!firstFrameRefId) return resources;
  const index = resources.findIndex((item) => item.id === firstFrameRefId);
  if (index <= 0) return resources;
  const ordered = [...resources];
  const [firstFrameResource] = ordered.splice(index, 1);
  ordered.unshift(firstFrameResource);
  return ordered;
}

export function getClipGenerationMaterials(clip: ClipItem): ClipGenerationMaterial[] {
  const snapshot = clip.formSnapshot;
  if (!snapshot) return [];

  const items: ClipGenerationMaterial[] = [];
  const usedUrls = new Set<string>();
  const referenceResources = Array.isArray(snapshot.referenceResources) ? snapshot.referenceResources : [];
  const firstUrl = normalizeUrl(snapshot.firstFrameUrl);
  const lastUrl = normalizeUrl(snapshot.lastFrameUrl);
  const mode = snapshot.mode;

  const pushMaterial = (item: ClipGenerationMaterial) => {
    if (usedUrls.has(item.url)) return;
    usedUrls.add(item.url);
    items.push(item);
  };

  if (mode === "first-last-frame") {
    if (firstUrl) {
      pushMaterial({
        id: `${clip.id}-first-frame`,
        name: "首帧图片",
        kind: "image",
        url: firstUrl,
        label: "首帧",
      });
    }
    if (lastUrl) {
      pushMaterial({
        id: `${clip.id}-last-frame`,
        name: "尾帧图片",
        kind: "image",
        url: lastUrl,
        label: "尾帧",
      });
    }
    return items;
  }

  const firstFrameRef =
    mode === "first-frame"
      ? referenceResources.find((item) => normalizeUrl(item.url) === firstUrl) ||
        getFirstImageReference(referenceResources)
      : null;
  const orderedResources = orderReferenceResources(referenceResources, firstFrameRef?.id ?? null);

  for (const resource of orderedResources) {
    const url = normalizeUrl(resource.url);
    if (!url) continue;

    const label =
      mode === "first-frame" && resource.id === firstFrameRef?.id
        ? "首帧"
        : getReferenceLabel(referenceResources, resource);

    pushMaterial({
      id: resource.id,
      name: resource.name || label,
      kind: resource.kind,
      url,
      label,
    });
  }

  if (mode === "first-frame" && firstUrl && !usedUrls.has(firstUrl)) {
    items.unshift({
      id: `${clip.id}-first-frame`,
      name: "首帧图片",
      kind: "image",
      url: firstUrl,
      label: "首帧",
    });
  }

  return items;
}
