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


export function normalizeComposeGroup(value: unknown): string | null {
  const group = String(value ?? "").trim();
  return group || null;
}

export function collectComposeGroups(clips: Array<Pick<AiVideoClip, "composeGroup">>): string[] {
  const names = new Set<string>();
  for (const clip of clips) {
    const group = normalizeComposeGroup(clip.composeGroup);
    if (group) names.add(group);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function filterClipsByComposeGroup<T extends Pick<AiVideoClip, "composeGroup">>(
  clips: T[],
  groupFilter: string | null | undefined
): T[] {
  const normalizedFilter = normalizeComposeGroup(groupFilter);
  if (!normalizedFilter) return clips;
  return clips.filter((clip) => normalizeComposeGroup(clip.composeGroup) === normalizedFilter);
}

export function filterClips<T extends Pick<AiVideoClip, "tag" | "composeGroup">>(
  clips: T[],
  filters: { tag?: string | null; composeGroup?: string | null }
): T[] {
  return filterClipsByComposeGroup(filterClipsByTag(clips, filters.tag), filters.composeGroup);
}

export function buildComposeGroupOptions(groups: string[]) {
  return groups.map((name) => ({ value: name, label: name }));
}
