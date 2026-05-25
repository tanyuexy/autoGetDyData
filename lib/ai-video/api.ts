import type { AiVideoComposedFilm } from "@/types";
import type { ClipItem } from "./types";

export async function fetchClipsFromServer(): Promise<ClipItem[]> {
  const res = await fetch("/api/ai-video/clips", { cache: "no-store" });
  const data = (await res.json()) as { items?: ClipItem[]; error?: string };
  if (!res.ok) throw new Error(data.error || "读取片段列表失败");
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchFilmsFromServer(): Promise<AiVideoComposedFilm[]> {
  const res = await fetch("/api/ai-video/films", { cache: "no-store" });
  const data = (await res.json()) as { items?: AiVideoComposedFilm[]; error?: string };
  if (!res.ok) throw new Error(data.error || "读取成片列表失败");
  return Array.isArray(data.items) ? data.items : [];
}

export async function deleteFilmFromServer(id: string) {
  const res = await fetch(`/api/ai-video/films?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error || "删除成片失败");
}

export async function saveClipToServer(clip: ClipItem): Promise<ClipItem> {
  const res = await fetch("/api/ai-video/clips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clip }),
  });
  const data = (await res.json()) as { clip?: ClipItem; error?: string };
  if (!res.ok || !data.clip) throw new Error(data.error || "保存片段失败");
  return data.clip;
}

export async function deleteClipFromServer(id: string) {
  const res = await fetch(`/api/ai-video/clips?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error || "删除片段失败");
}
