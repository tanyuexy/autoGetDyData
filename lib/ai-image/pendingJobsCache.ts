import {
  readLocalStorageJson,
  writeLocalStorageJson,
} from "@/lib/browserStorage";

const PENDING_JOBS_CACHE_KEY = "ai-image:pending-job-ids";
const MAX_PENDING_JOB_IDS = 32;

export function readPendingAiImageJobIds(): string[] {
  const parsed = readLocalStorageJson<unknown>(PENDING_JOBS_CACHE_KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, MAX_PENDING_JOB_IDS);
}

export function addPendingAiImageJobId(jobId: string) {
  const id = String(jobId || "").trim();
  if (!id) return false;
  const next = [id, ...readPendingAiImageJobIds().filter((item) => item !== id)].slice(
    0,
    MAX_PENDING_JOB_IDS
  );
  return writeLocalStorageJson(PENDING_JOBS_CACHE_KEY, next);
}

export function removePendingAiImageJobId(jobId: string) {
  const id = String(jobId || "").trim();
  if (!id) return false;
  const next = readPendingAiImageJobIds().filter((item) => item !== id);
  return writeLocalStorageJson(PENDING_JOBS_CACHE_KEY, next);
}
