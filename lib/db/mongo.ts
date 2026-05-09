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
  ]);
}
