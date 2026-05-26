import type { AiVideoClip } from "@/types";

export function normalizeClipTag(value: unknown): string | null {
  const tag = String(value ?? "").trim();
  return tag || null;
}

export function collectClipTags(clips: Array<Pick<AiVideoClip, "tag">>): string[] {
  const names = new Set<string>();
  for (const clip of clips) {
    const tag = normalizeClipTag(clip.tag);
    if (tag) names.add(tag);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function filterClipsByTag<T extends Pick<AiVideoClip, "tag">>(
  clips: T[],
  tagFilter: string | null | undefined
): T[] {
  const normalizedFilter = normalizeClipTag(tagFilter);
  if (!normalizedFilter) return clips;
  return clips.filter((clip) => normalizeClipTag(clip.tag) === normalizedFilter);
}

export function buildClipTagOptions(tags: string[]) {
  return tags.map((name) => ({ value: name, label: name }));
}
