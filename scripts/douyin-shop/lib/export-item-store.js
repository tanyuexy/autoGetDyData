const fse = require("fs-extra");
const { MongoClient } = require("mongodb");

let client = null;
let db = null;
let indexesReady = false;

function getRunId(runId) {
  return String(runId || "manual").trim() || "manual";
}

function getItemKey({ runId, accountEmail, shopName, kind, dataDate }) {
  return [
    getRunId(runId),
    String(accountEmail || ""),
    String(shopName || ""),
    String(kind || ""),
    String(dataDate || "")
  ].join("|");
}

async function getDb() {
  if (db) return db;
  if (!process.env.MONGODB_URI) return null;
  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db(process.env.MONGODB_DB || "autoGetDyData");
  return db;
}

async function ensureIndexes(database) {
  if (indexesReady || !database) return;
  await database.collection("shop_export_items").createIndexes([
    { key: { key: 1 }, name: "key_unique", unique: true },
    { key: { runId: 1, status: 1 }, name: "run_status" },
    { key: { shopName: 1, kind: 1, dataDate: 1 }, name: "shop_kind_date" },
    { key: { updatedAt: -1 }, name: "updatedAt" }
  ]);
  indexesReady = true;
}

async function updateItem(input, update) {
  try {
    const database = await getDb();
    if (!database) return;
    await ensureIndexes(database);
    const now = new Date();
    const base = {
      key: getItemKey(input),
      runId: getRunId(input.runId),
      accountEmail: String(input.accountEmail || ""),
      shopName: String(input.shopName || ""),
      kind: String(input.kind || ""),
      dataDate: String(input.dataDate || ""),
      expectedDate: String(input.expectedDate || input.dataDate || ""),
      updatedAt: now
    };
    await database.collection("shop_export_items").updateOne(
      { key: base.key },
      {
        $setOnInsert: { createdAt: now },
        ...update,
        $set: { ...(update.$set || {}), ...base, updatedAt: now }
      },
      { upsert: true }
    );
  } catch (error) {
    console.warn(`[shop-export-items] 写入状态失败: ${error.message || error}`);
  }
}

async function markRunning(input) {
  await updateItem(input, {
    $set: {
      status: "running",
      startedAt: new Date()
    },
    $unset: { error: "", filePath: "", fileSize: "", finishedAt: "" },
    $inc: { attempts: 1 }
  });
}

async function markSuccess(input, filePath) {
  let fileSize = null;
  try {
    fileSize = (await fse.stat(filePath)).size;
  } catch {
    // keep null
  }
  await updateItem(input, {
    $set: {
      status: "success",
      filePath,
      fileSize,
      finishedAt: new Date()
    },
    $unset: { error: "" }
  });
}

async function markFailed(input, error) {
  await updateItem(input, {
    $set: {
      status: "failed",
      error: error?.message || String(error || "unknown"),
      finishedAt: new Date()
    }
  });
}

async function listFailedItems(options = {}) {
  const database = await getDb();
  if (!database) {
    throw new Error("MONGODB_URI is required for shop export retry");
  }
  await ensureIndexes(database);

  let runId = options.runId ? getRunId(options.runId) : null;
  if (!runId) {
    const latest = await database
      .collection("shop_export_items")
      .find({ status: "failed" })
      .sort({ updatedAt: -1 })
      .limit(1)
      .next();
    runId = latest?.runId || null;
  }
  if (!runId) return [];

  return database
    .collection("shop_export_items")
    .find({ runId, status: "failed" })
    .sort({ shopName: 1, dataDate: 1, kind: 1 })
    .toArray();
}

async function closeExportItemStore() {
  if (client) await client.close().catch(() => {});
  client = null;
  db = null;
  indexesReady = false;
}

module.exports = {
  closeExportItemStore,
  listFailedItems,
  markFailed,
  markRunning,
  markSuccess
};
