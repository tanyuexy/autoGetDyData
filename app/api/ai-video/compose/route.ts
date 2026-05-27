import { NextRequest, NextResponse } from "next/server";
import type { ComposeGroupInput, ComposeRequest, ComposeSegmentInput } from "@/lib/videoComposeShared";
import { requireAppSession, resolveOwnerUsername } from "@/lib/auth/requireSession";
import { saveComposedFilmsFromResults } from "@/lib/aiVideoComposedFilmService";
import { runComposeRequest } from "@/lib/videoCompose";

export const runtime = "nodejs";

function normalizeSegment(item: unknown): ComposeSegmentInput | null {
  if (!item || typeof item !== "object") return null;
  const row = item as { id?: string; name?: string; videoUrl?: string };
  if (!row.videoUrl) return null;
  return {
    id: String(row.id || row.videoUrl),
    name: String(row.name || row.id || "片段"),
    videoUrl: String(row.videoUrl),
  };
}

function normalizeGroup(item: unknown): ComposeGroupInput | null {
  if (!item || typeof item !== "object") return null;
  const row = item as { name?: string; segments?: unknown[] };
  const name = String(row.name || "").trim();
  const segments = Array.isArray(row.segments)
    ? row.segments.map(normalizeSegment).filter(Boolean)
    : [];
  if (!name || !segments.length) return null;
  return { name, segments: segments as ComposeSegmentInput[] };
}

export async function POST(request: NextRequest) {
  const session = await requireAppSession(request);
  if (session instanceof NextResponse) return session;
  try {
    const body = await request.json();
    const mode = body.mode === "random" ? "random" : "sequential";

    let composeRequest: ComposeRequest;
    if (mode === "random") {
      const groups = (Array.isArray(body.groups) ? body.groups : [])
        .map(normalizeGroup)
        .filter(Boolean) as ComposeGroupInput[];
      composeRequest = {
        mode: "random",
        groups,
        outputCount: Number(body.outputCount) || 1,
        orderRule: typeof body.orderRule === "string" ? body.orderRule : "",
        addBackgroundMusic: body.addBackgroundMusic !== false,
      };
    } else {
      const segments = (Array.isArray(body.segments) ? body.segments : [])
        .slice(0, 30)
        .map(normalizeSegment)
        .filter(Boolean) as ComposeSegmentInput[];
      composeRequest = {
        mode: "sequential",
        segments,
        addBackgroundMusic: body.addBackgroundMusic !== false,
      };
    }

    const result = await runComposeRequest(composeRequest);
    const savedFilms = await saveComposedFilmsFromResults(result.films, resolveOwnerUsername(session));
    const primaryFilm = savedFilms[0] || result.films[0];

    return NextResponse.json({
      ok: true,
      mode: result.mode,
      generated: result.generated,
      films: savedFilms.length ? savedFilms : result.films,
      videoUrl: primaryFilm?.videoUrl || null,
      segmentCount: primaryFilm?.segments?.length || result.films[0]?.segmentCount || 0,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "合成视频失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
