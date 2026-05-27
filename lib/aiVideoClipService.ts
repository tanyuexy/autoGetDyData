import type { AiVideoClip, AiVideoClipTokenUsage } from "@/types";
import { normalizeTokenUsage } from "@/lib/ai-video/tokenUsage";
import { assertAiVideoAdminCanDelete } from "@/lib/auth/aiVideoOwner";
import { isClipCompleted } from "@/lib/ai-video/clipUtils";
import { archiveClipVideo, isLocalGeneratedVideoUrl } from "@/lib/aiVideoMedia";
import { getDb } from "./db/mongo";

const COLLECTION = "ai_video_clips";

function normalizeClip(doc: unknown): AiVideoClip | null {
  if (!doc || typeof doc !== "object") return null;
  const item = doc as AiVideoClip;
  if (typeof item.id !== "string" || typeof item.name !== "string") return null;
  return {
    id: item.id,
    name: item.name,
    model: String(item.model || ""),
    prompt: String(item.prompt || ""),
    mode:
      item.mode === "first-frame" ||
      item.mode === "first-last-frame" ||
      item.mode === "multimodal-reference" ||
      item.mode === "text"
        ? item.mode
        : "text",
    status: String(item.status || "unknown"),
    taskId: item.taskId,
    videoUrl: item.videoUrl ?? null,
    remoteVideoUrl: item.remoteVideoUrl ?? null,
    coverUrl: item.coverUrl ?? null,
    duration: Number(item.duration) || 0,
    ratio: String(item.ratio || "9:16"),
    resolution: String(item.resolution || "720p"),
    composeGroup: item.composeGroup ? String(item.composeGroup) : null,
    tag: item.tag ? String(item.tag).trim() || null : null,
    username: item.username ? String(item.username).trim() || null : null,
    tokenUsage: normalizeTokenUsage(item.tokenUsage),
    createdAt: String(item.createdAt || new Date().toISOString()),
    updatedAt: String(item.updatedAt || item.createdAt || new Date().toISOString()),
    formSnapshot: item.formSnapshot,
  };
}

function toDocument(clip: AiVideoClip) {
  const now = new Date().toISOString();
  return {
    ...clip,
    _id: clip.id,
    createdAt: clip.createdAt || now,
    updatedAt: now,
  };
}

function preferLatestTokenUsage(
  latest?: AiVideoClipTokenUsage | null,
  fallback?: AiVideoClipTokenUsage | null
) {
  return normalizeTokenUsage(latest) ?? normalizeTokenUsage(fallback) ?? null;
}

export async function readAiVideoClips(): Promise<AiVideoClip[]> {
  const db = await getDb();
  const docs = await db.collection(COLLECTION).find({}).sort({ createdAt: -1 }).toArray();
  return docs.map(normalizeClip).filter(Boolean) as AiVideoClip[];
}

export async function upsertAiVideoClip(
  input: AiVideoClip,
  ownerUsername?: string
): Promise<AiVideoClip> {
  const clip = normalizeClip(input);
  if (!clip) throw new Error("片段数据无效");

  const db = await getDb();
  const existing = normalizeClip(await db.collection(COLLECTION).findOne({ id: clip.id }));

  let videoUrl = clip.videoUrl;
  let remoteVideoUrl = clip.remoteVideoUrl ?? null;
  if (videoUrl && !isLocalGeneratedVideoUrl(videoUrl)) {
    remoteVideoUrl = videoUrl;
    videoUrl = await archiveClipVideo(videoUrl, clip.id);
  }

  const saved: AiVideoClip = {
    ...clip,
    username: existing?.username || ownerUsername || clip.username || null,
    tokenUsage: preferLatestTokenUsage(clip.tokenUsage, existing?.tokenUsage),
    videoUrl,
    remoteVideoUrl,
    updatedAt: new Date().toISOString(),
  };
  await db.collection(COLLECTION).replaceOne({ id: saved.id }, toDocument(saved), { upsert: true });
  return saved;
}

export async function upsertAiVideoClips(
  items: AiVideoClip[],
  ownerUsername?: string
): Promise<AiVideoClip[]> {
  const saved: AiVideoClip[] = [];
  for (const item of items) {
    saved.push(await upsertAiVideoClip(item, ownerUsername));
  }
  return saved;
}

export async function updateAiVideoClipFromTask(
  clipId: string,
  task: {
    status?: string;
    videoUrl?: string | null;
    coverUrl?: string | null;
    tokenUsage?: AiVideoClipTokenUsage | null;
    raw?: unknown;
  },
  ownerUsername?: string
): Promise<AiVideoClip | null> {
  const db = await getDb();
  const existing = normalizeClip(await db.collection(COLLECTION).findOne({ id: clipId }));
  if (!existing) return null;

  let videoUrl = existing.videoUrl ?? null;
  let remoteVideoUrl = existing.remoteVideoUrl ?? null;
  const incomingVideoUrl = task.videoUrl || null;

  if (incomingVideoUrl) {
    if (isLocalGeneratedVideoUrl(incomingVideoUrl)) {
      videoUrl = incomingVideoUrl;
    } else if (!videoUrl || !isLocalGeneratedVideoUrl(videoUrl)) {
      remoteVideoUrl = incomingVideoUrl;
      videoUrl = await archiveClipVideo(incomingVideoUrl, clipId);
    }
  }

  const updated: AiVideoClip = {
    ...existing,
    status: task.status || existing.status,
    videoUrl,
    remoteVideoUrl,
    coverUrl: task.coverUrl ?? existing.coverUrl ?? null,
    tokenUsage: preferLatestTokenUsage(task.tokenUsage, existing.tokenUsage),
    updatedAt: new Date().toISOString(),
  };

  await db.collection(COLLECTION).replaceOne({ id: clipId }, toDocument(updated), { upsert: true });
  return updated;
}

export async function deleteAiVideoClip(id: string, actorUsername?: string): Promise<boolean> {
  assertAiVideoAdminCanDelete(actorUsername);
  const db = await getDb();
  const existing = normalizeClip(await db.collection(COLLECTION).findOne({ id }));
  if (!existing) return false;
  if (!isClipCompleted(existing.status)) {
    throw new Error("仅可删除已完成状态的片段");
  }
  const result = await db.collection(COLLECTION).deleteOne({ id });
  return result.deletedCount > 0;
}
