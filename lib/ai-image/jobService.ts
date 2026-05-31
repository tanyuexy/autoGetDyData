import { randomBytes } from "crypto";
import { generateAiImages } from "./newApiImage";
import type { AiGeneratedImage, AiImageJob, AiImageJobRequest, AiImageJobStatus } from "./types";
import { getDb } from "@/lib/db/mongo";

const COLLECTION = "ai_image_jobs";
const inflightJobIds = new Set<string>();

function createJobId() {
  return `aiimg-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function normalizeJob(doc: unknown): AiImageJob | null {
  if (!doc || typeof doc !== "object") return null;
  const row = doc as Record<string, unknown>;
  const id = String(row.id || row._id || "").trim();
  const request = row.request as AiImageJobRequest | undefined;
  if (!id || !request || typeof request.prompt !== "string") return null;
  const status = String(row.status || "queued") as AiImageJobStatus;
  return {
    id,
    status:
      status === "running" || status === "succeeded" || status === "failed" ? status : "queued",
    request,
    images: Array.isArray(row.images) ? (row.images as AiGeneratedImage[]) : undefined,
    model: row.model ? String(row.model) : undefined,
    error: row.error ? String(row.error) : null,
    ownerUsername: row.ownerUsername ? String(row.ownerUsername) : null,
    createdAt: String(row.createdAt || new Date().toISOString()),
    updatedAt: String(row.updatedAt || row.createdAt || new Date().toISOString()),
  };
}

export async function createAiImageJob(input: {
  request: AiImageJobRequest;
  ownerUsername?: string;
}): Promise<AiImageJob> {
  const now = new Date().toISOString();
  const id = createJobId();
  const job: AiImageJob = {
    id,
    status: "queued",
    request: input.request,
    ownerUsername: input.ownerUsername || null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDb();
  await db.collection<AiImageJob>(COLLECTION).insertOne(job);
  return job;
}

export async function getAiImageJob(jobId: string, ownerUsername?: string): Promise<AiImageJob | null> {
  const db = await getDb();
  const doc = await db.collection<AiImageJob>(COLLECTION).findOne({ id: jobId });
  const job = normalizeJob(doc);
  if (!job) return null;
  if (ownerUsername && job.ownerUsername && job.ownerUsername !== ownerUsername) {
    return null;
  }
  return job;
}

async function patchAiImageJob(
  jobId: string,
  patch: Partial<Pick<AiImageJob, "status" | "images" | "model" | "error">>
) {
  const db = await getDb();
  await db.collection<AiImageJob>(COLLECTION).updateOne(
    { id: jobId },
    {
      $set: {
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    }
  );
}

async function executeAiImageJob(jobId: string) {
  const job = await getAiImageJob(jobId);
  if (!job || job.status !== "queued") return;

  await patchAiImageJob(jobId, { status: "running", error: null });

  try {
    const result = await generateAiImages({
      prompt: job.request.prompt,
      size: job.request.size,
      quality: job.request.quality,
      count: job.request.count,
      referenceImageUrls: job.request.referenceImageUrls,
    });
    await patchAiImageJob(jobId, {
      status: "succeeded",
      images: result.images,
      model: result.model,
      error: null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "图片生成失败";
    await patchAiImageJob(jobId, { status: "failed", error: message });
  }
}

export function scheduleAiImageJob(jobId: string) {
  if (inflightJobIds.has(jobId)) return;
  inflightJobIds.add(jobId);
  void executeAiImageJob(jobId).finally(() => {
    inflightJobIds.delete(jobId);
  });
}
