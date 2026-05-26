import { Db, MongoClient } from "mongodb";

const DEFAULT_DB_NAME = "autoGetDyData";

type MongoGlobal = typeof globalThis & {
  __autoGetDyDataMongoClientPromise__?: Promise<MongoClient>;
};

function getMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }
  return uri;
}

export async function getMongoClient(): Promise<MongoClient> {
  const g = globalThis as MongoGlobal;
  if (!g.__autoGetDyDataMongoClientPromise__) {
    const client = new MongoClient(getMongoUri());
    g.__autoGetDyDataMongoClientPromise__ = client.connect();
  }
  return g.__autoGetDyDataMongoClientPromise__;
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(process.env.MONGODB_DB || DEFAULT_DB_NAME);
}

export async function ensureMongoIndexes(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection("creator_publish_tasks").createIndexes([
      { key: { status: 1, updatedAt: -1 }, name: "status_updatedAt" },
      { key: { accountName: 1, status: 1 }, name: "account_status" },
      {
        key: { feishuRecordId: 1 },
        name: "feishuRecordId_unique",
        unique: true,
        sparse: true,
      },
      { key: { taskId: 1 }, name: "taskId_sparse", sparse: true },
    ]),
    db.collection("runtime_processes").createIndexes([
      { key: { namespace: 1 }, name: "namespace" },
      { key: { updatedAt: -1 }, name: "updatedAt" },
    ]),
    db.collection("task_jobs").createIndexes([
      { key: { status: 1, namespace: 1, createdAt: 1 }, name: "status_namespace_createdAt" },
      { key: { taskId: 1 }, name: "taskId_unique", unique: true },
      { key: { namespace: 1, status: 1 }, name: "namespace_status" },
    ]),
    db.collection("shop_export_items").createIndexes([
      { key: { key: 1 }, name: "key_unique", unique: true },
      { key: { runId: 1, status: 1 }, name: "run_status" },
      { key: { shopName: 1, kind: 1, dataDate: 1 }, name: "shop_kind_date" },
      { key: { updatedAt: -1 }, name: "updatedAt" },
    ]),
    db.collection("creator_review_items").createIndexes([
      { key: { accountName: 1, checkedAt: -1 }, name: "account_checkedAt" },
      { key: { postId: 1 }, name: "postId_unique", unique: true, sparse: true },
      { key: { reviewStatus: 1 }, name: "reviewStatus" },
    ]),
    db.collection("ai_video_clips").createIndexes([
      { key: { createdAt: -1 }, name: "createdAt" },
      { key: { taskId: 1 }, name: "taskId_sparse", sparse: true },
      { key: { status: 1, updatedAt: -1 }, name: "status_updatedAt" },
      { key: { tag: 1, createdAt: -1 }, name: "tag_createdAt", sparse: true },
    ]),
    db.collection("ai_video_composed_films").createIndexes([
      { key: { createdAt: -1 }, name: "createdAt" },
      { key: { videoUrl: 1 }, name: "videoUrl" },
    ]),
    db.collection("creator_comment_items").createIndexes([
      { key: { accountName: 1, fetchedAt: -1 }, name: "account_fetchedAt" },
      { key: { cid: 1 }, name: "cid_sparse", sparse: true },
      { key: { awemeId: 1 }, name: "awemeId" },
    ]),
  ]);
}
