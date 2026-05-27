import type { AiVideoComposedFilm, AiVideoComposedFilmSegment } from "@/types";
import { assertAiVideoAdminCanDelete } from "@/lib/auth/aiVideoOwner";
import type { ComposeFilmResult } from "@/lib/videoComposeShared";
import { getDb } from "./db/mongo";

const COLLECTION = "ai_video_composed_films";

function createFilmId() {
  return `film-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeSegment(item: unknown, index: number): AiVideoComposedFilmSegment | null {
  if (!item || typeof item !== "object") return null;
  const row = item as { id?: string; name?: string; order?: number };
  const id = String(row.id || "").trim();
  const name = String(row.name || "").trim();
  if (!id || !name) return null;
  const order = Number.isInteger(row.order) && Number(row.order) > 0 ? Number(row.order) : index + 1;
  return { id, name, order };
}

function normalizeFilm(doc: unknown): AiVideoComposedFilm | null {
  if (!doc || typeof doc !== "object") return null;
  const item = doc as AiVideoComposedFilm;
  if (typeof item.id !== "string" || typeof item.videoUrl !== "string") return null;
  const segments = Array.isArray(item.segments)
    ? item.segments
        .map((segment, index) => normalizeSegment(segment, index))
        .filter(Boolean)
        .sort((a, b) => a!.order - b!.order) as AiVideoComposedFilmSegment[]
    : [];
  return {
    id: item.id,
    videoUrl: item.videoUrl,
    mode: item.mode === "random" ? "random" : "sequential",
    segments,
    backgroundMusic: item.backgroundMusic ? String(item.backgroundMusic) : null,
    comboIndex: typeof item.comboIndex === "number" ? item.comboIndex : null,
    username: item.username ? String(item.username).trim() || null : null,
    createdAt: String(item.createdAt || new Date().toISOString()),
  };
}

function toDocument(film: AiVideoComposedFilm) {
  return {
    ...film,
    _id: film.id,
  };
}

function filmFromComposeResult(result: ComposeFilmResult, ownerUsername?: string): AiVideoComposedFilm {
  const now = new Date().toISOString();
  return {
    id: createFilmId(),
    videoUrl: result.videoUrl,
    mode: result.mode,
    segments: result.segments.map((segment, index) => ({
      id: segment.id,
      name: segment.name,
      order: index + 1,
    })),
    backgroundMusic: result.backgroundMusic ?? null,
    comboIndex: result.comboIndex ?? null,
    username: ownerUsername || null,
    createdAt: now,
  };
}

export async function readAiVideoComposedFilms(): Promise<AiVideoComposedFilm[]> {
  const db = await getDb();
  const docs = await db.collection(COLLECTION).find({}).sort({ createdAt: -1 }).toArray();
  return docs.map(normalizeFilm).filter(Boolean) as AiVideoComposedFilm[];
}

export async function saveComposedFilmsFromResults(
  results: ComposeFilmResult[],
  ownerUsername?: string
): Promise<AiVideoComposedFilm[]> {
  if (!results.length) return [];
  const db = await getDb();
  const saved = results.map((r) => filmFromComposeResult(r, ownerUsername));
  for (const film of saved) {
    await db.collection(COLLECTION).replaceOne({ id: film.id }, toDocument(film), { upsert: true });
  }
  return saved;
}

export async function deleteAiVideoComposedFilm(id: string, actorUsername?: string): Promise<boolean> {
  assertAiVideoAdminCanDelete(actorUsername);
  const db = await getDb();
  const existing = normalizeFilm(await db.collection(COLLECTION).findOne({ id }));
  if (!existing) return false;
  const result = await db.collection(COLLECTION).deleteOne({ id });
  return result.deletedCount > 0;
}
