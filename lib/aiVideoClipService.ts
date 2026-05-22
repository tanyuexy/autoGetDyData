import type { AiVideoClip } from "@/types";
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
      item.mode === "first-frame" || item.mode === "first-last-frame" || item.mode === "text"
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

export async function readAiVideoClips(): Promise<AiVideoClip[]> {
  const db = await getDb();
  const docs = await db.collection(COLLECTION).find({}).sort({ createdAt: -1 }).toArray();
  return docs.map(normalizeClip).filter(Boolean) as AiVideoClip[];
}

export async function upsertAiVideoClip(input: AiVideoClip): Promise<AiVideoClip> {
  const clip = normalizeClip(input);
  if (!clip) throw new Error("片段数据无效");

  let videoUrl = clip.videoUrl;
  let remoteVideoUrl = clip.remoteVideoUrl ?? null;
  if (videoUrl && !isLocalGeneratedVideoUrl(videoUrl)) {
    remoteVideoUrl = videoUrl;
    videoUrl = await archiveClipVideo(videoUrl, clip.id);
  }

  const saved: AiVideoClip = {
    ...clip,
    videoUrl,
    remoteVideoUrl,
    updatedAt: new Date().toISOString(),
  };
  const db = await getDb();
  await db.collection(COLLECTION).replaceOne({ id: saved.id }, toDocument(saved), { upsert: true });
  return saved;
}

export async function upsertAiVideoClips(items: AiVideoClip[]): Promise<AiVideoClip[]> {
  const saved: AiVideoClip[] = [];
  for (const item of items) {
    saved.push(await upsertAiVideoClip(item));
  }
  return saved;
}

export async function updateAiVideoClipFromTask(
  clipId: string,
  task: { status?: string; videoUrl?: string | null; coverUrl?: string | null }
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
    updatedAt: new Date().toISOString(),
  };

  await db.collection(COLLECTION).replaceOne({ id: clipId }, toDocument(updated), { upsert: true });
  return updated;
}

export async function deleteAiVideoClip(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.collection(COLLECTION).deleteOne({ id });
  return result.deletedCount > 0;
}
