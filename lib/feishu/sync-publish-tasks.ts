// @ts-nocheck
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const { readBitable } = require("./core/readBitable");
const { downloadAttachment, updateBitableRecord } = require("./core/bitable");
const { loadFeishuBitableConfigForProfile } = require("./core/config");
const { getValidAccessToken } = require("./core/oauth");

const MATERIALS_DIR = path.resolve(
  process.cwd(),
  process.env.CREATOR_MATERIALS_DIR || "storage/creator-materials"
);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function generateTaskId() {
  return crypto.randomBytes(8).toString("hex");
}

function makeUniqueFileName(originalName, dir) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const candidates = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  let name = originalName;
  let i = 1;
  while (candidates.has(name)) {
    name = `${base}-${i}${ext}`;
    i++;
  }
  return name;
}

async function getMongoDb() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "autoGetDyData");
  await db.collection("creator_publish_tasks").createIndexes([
    { key: { status: 1, updatedAt: -1 }, name: "status_updatedAt" },
    { key: { accountName: 1, status: 1 }, name: "account_status" },
    {
      key: { feishuRecordId: 1 },
      name: "feishuRecordId_unique",
      unique: true,
      sparse: true,
    },
    { key: { taskId: 1 }, name: "taskId_sparse", sparse: true },
  ]);
  return { client, db };
}

async function loadExistingTasksByFeishuRecordId(db) {
  const docs = await db
    .collection("creator_publish_tasks")
    .find(
      { feishuRecordId: { $exists: true, $ne: "" } },
      {
        projection: {
          id: 1,
          status: 1,
          accountName: 1,
          payload: 1,
          feishuRecordId: 1,
          feishuContentHash: 1,
          feishuRowNumber: 1,
        },
      }
    )
    .toArray();
  return new Map(
    docs
      .filter((doc) => doc && doc.feishuRecordId)
      .map((doc) => [doc.feishuRecordId, doc])
  );
}

const MAX_RECOGNIZED_HASHTAG_LENGTH = 10;

function cleanHashtag(tag) {
  return String(tag || "").replace(/\s+/g, "").trim();
}

function getHashtagLength(tag) {
  return Array.from(tag).length;
}

/**
 * 与 scripts/douyin-creator/publish/editor.js 的 splitDescription 保持一致。
 * 从正文中提取 #话题，短话题（≤10字）从正文移除，长话题保留在正文中。
 */
function splitDescription(text) {
  const hashtags = [];
  const plainHashtags = [];

  let body = String(text || "")
    .replace(/#([^\s#]+)/g, (_matched, rawTag) => {
      const tag = cleanHashtag(rawTag);
      if (!tag) return "";

      if (getHashtagLength(tag) > MAX_RECOGNIZED_HASHTAG_LENGTH) {
        if (!plainHashtags.includes(tag)) {
          plainHashtags.push(tag);
        }
        return rawTag.trim();
      }

      if (!hashtags.includes(tag)) {
        hashtags.push(tag);
      }
      return "";
    })
    .replace(/(^|\s)#(?=\s|$)/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!body && hashtags.length === 0 && plainHashtags.length === 0) {
    body = String(text || "").trim();
  }

  return { body, hashtags, plainHashtags };
}

function normalizeDescriptionForPublish(text) {
  const { body, hashtags } = splitDescription(text);
  const topicText = hashtags.map((tag) => `#${tag}`).join(" ");
  const normalizedText = [body, topicText].filter(Boolean).join("\n\n");
  return { body, hashtags, normalizedText };
}

function inferType(attachments) {
  const hasVideo = (attachments || []).some((att) => {
    const t = (att.type || "").toLowerCase();
    return t.startsWith("video/");
  });
  return hasVideo ? "video" : "article";
}

function parseScheduleAt(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;

  const numericTs = Number(raw);
  if (Number.isFinite(numericTs) && numericTs > 0) {
    const d = new Date(numericTs);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const d = new Date(String(raw).trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatImportErrorStatus(error) {
  const raw = error && error.message ? error.message : String(error || "未知错误");
  return `创建失败: ${raw}`.replace(/\s+/g, " ").trim().slice(0, 200);
}

function normalizeAttachmentSignature(attachments) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((att) => ({
      fileToken: String(att?.file_token || att?.fileToken || ""),
      name: String(att?.name || ""),
      type: String(att?.type || ""),
      size: Number(att?.size || 0),
    }))
    .filter((att) => att.fileToken || att.name)
    .sort((a, b) => `${a.fileToken}:${a.name}`.localeCompare(`${b.fileToken}:${b.name}`));
}

function buildRecordSnapshot(record) {
  const f = record.fields || {};
  const accountName = f["所属店铺"]?.[0]?.text || "";
  const attachments = f["视频/图文内容"] || [];
  const linkField = f["挂车链接"];
  const productLink = Array.isArray(linkField) ? (linkField[0]?.link || "") : "";
  const productNameField = f["挂车产品名"];
  const productTitle = Array.isArray(productNameField)
    ? (productNameField[0]?.text || "")
    : "";
  const title = String(f["标题（可为空）"] || "").trim();
  const rawDescription = String(f["正文"] || "").trim();
  const { normalizedText: fullDescription } = normalizeDescriptionForPublish(rawDescription);
  const isAiContent = String(f["ai内容"] || "").trim() === "是";
  const scheduleRaw = f["计划发布时间"];
  const scheduleAt = parseScheduleAt(scheduleRaw);
  const type = inferType(attachments);
  const remoteCreatedStatus = String(f["已创建任务"] || "").trim();

  return {
    accountName,
    attachments,
    productLink,
    productTitle,
    title,
    description: fullDescription,
    rawDescription,
    isAiContent,
    scheduleRaw,
    scheduleAt,
    type,
    remoteCreatedStatus,
  };
}

function buildFeishuContentHash(snapshot) {
  const payloadSignature = {
    accountName: snapshot.accountName,
    type: snapshot.type,
    title: snapshot.title,
    description: snapshot.description,
    isAiContent: snapshot.isAiContent === true,
    scheduleAt: snapshot.scheduleAt || null,
    productLink: snapshot.productLink || "",
    productTitle: snapshot.productTitle || "",
    attachments: normalizeAttachmentSignature(snapshot.attachments),
  };
  return crypto.createHash("sha1").update(JSON.stringify(payloadSignature)).digest("hex");
}

function buildCoreContentHash(input) {
  const payloadSignature = {
    accountName: String(input?.accountName || ""),
    type: String(input?.type || ""),
    title: String(input?.title || ""),
    description: String(input?.description || ""),
    isAiContent: input?.isAiContent === true,
    scheduleAt: input?.scheduleAt || null,
    productLink: String(input?.productLink || ""),
    productTitle: String(input?.productTitle || ""),
  };
  return crypto.createHash("sha1").update(JSON.stringify(payloadSignature)).digest("hex");
}

function buildTaskComparableInput(task) {
  const payload = task?.payload || {};
  return {
    accountName: task?.accountName || "",
    type: payload.type || "",
    title: payload.title || "",
    description: payload.description || "",
    isAiContent: payload.isAiContent === true,
    scheduleAt: payload.scheduleAt || null,
    productLink: payload.productLink || "",
    productTitle: payload.productTitle || "",
  };
}

function buildSnapshotComparableInput(snapshot) {
  return {
    accountName: snapshot.accountName,
    type: snapshot.type,
    title: snapshot.title,
    description: snapshot.description,
    isAiContent: snapshot.isAiContent === true,
    scheduleAt: snapshot.scheduleAt || null,
    productLink: snapshot.productLink || "",
    productTitle: snapshot.productTitle || "",
  };
}

function getExistingTaskSyncState(existingTask, snapshot, contentHash) {
  if (!existingTask) return { action: "create" };
  if (existingTask.status === "running") return { action: "skip-running" };
  if (snapshot.remoteCreatedStatus === "是") return { action: "skip-remote-created" };

  const taskContentHash = buildCoreContentHash(buildTaskComparableInput(existingTask));
  const snapshotContentHash = buildCoreContentHash(buildSnapshotComparableInput(snapshot));

  if (taskContentHash === snapshotContentHash) {
    return existingTask.feishuContentHash === contentHash
      ? { action: "skip-unchanged" }
      : { action: "backfill-hash-only" };
  }

  return { action: "update" };
}

function buildTaskPayload(snapshot, downloaded) {
  return {
    type: snapshot.type,
    title: snapshot.title,
    description: snapshot.description,
    isAiContent: snapshot.isAiContent,
    scheduleAt: snapshot.scheduleAt,
    ...(snapshot.productLink
      ? {
        productTitle: snapshot.productTitle || "还少胶囊",
        approvalNumber: "不包含广审内容",
        productLink: snapshot.productLink,
      }
      : {}),
    ...(snapshot.type === "video"
      ? { videoFileKey: downloaded[0] }
      : { imagesFileKeys: downloaded }),
  };
}

function getRecordEligibilityIssue(record) {
  const f = record.fields || {};
  const needsAutomation = String(f["是否需要自动化"] || "").trim();
  if (needsAutomation === "否") return "是否需要自动化为否";
  const approval = String(f["审批"] || "").trim();
  if (approval !== "通过") return `审批不是通过(${approval || "空"})`;
  const remark = String(f["备注"] || "").trim();
  if (remark === "示例") return "备注为示例";
  const shop = f["所属店铺"];
  if (!shop || !Array.isArray(shop) || !shop[0]?.text) return "缺少所属店铺";
  const attachments = f["视频/图文内容"];
  if (!attachments || !Array.isArray(attachments) || !attachments.length) {
    return "缺少视频/图文内容";
  }
  return "";
}

function summarizeEligibility(records) {
  const stats = {
    eligible: 0,
    skippedByIssue: new Map(),
  };

  for (const record of records) {
    const issue = getRecordEligibilityIssue(record);
    if (!issue) {
      stats.eligible++;
      continue;
    }
    stats.skippedByIssue.set(issue, (stats.skippedByIssue.get(issue) || 0) + 1);
  }

  return stats;
}

async function syncPublishTasks(options = {}) {
  const {
    autoStart = false,
    allowCreate = true,
    logger = console.log,
    summaryPrefix = "[sync-publish-tasks]",
  } = options;

  const log = (...args) => logger(...args);

  const { client, db } = await getMongoDb();
  try {
    log(`${summaryPrefix} 开始从飞书读取任务表...`);
    if (autoStart && allowCreate) {
      log(`${summaryPrefix} 已启用 auto-start，新导入任务将直接进入队列`);
    }

    const existingTasksByRecordId = await loadExistingTasksByFeishuRecordId(db);
    if (existingTasksByRecordId.size > 0) {
      log(`  Mongo 已有 ${existingTasksByRecordId.size} 个飞书导入任务，将执行增量同步`);
    }

    const { records } = await readBitable("task");
    log(`  找到 ${records.length} 条飞书记录`);

    const rowNumberMap = new Map();
    records.forEach((record, index) => {
      if (record?.record_id) {
        rowNumberMap.set(String(record.record_id), index + 1);
      }
    });

    let rowUpdatedCount = 0;
    for (const [recordId, task] of existingTasksByRecordId) {
      const nextRowNumber = rowNumberMap.get(recordId);
      if ((task.feishuRowNumber || null) === (nextRowNumber || null)) continue;
      const rowTs = new Date().toISOString();
      await db.collection("creator_publish_tasks").updateOne(
        { id: task.id },
        nextRowNumber
          ? {
              $set: {
                feishuRowNumber: nextRowNumber,
                updatedAt: rowTs,
                displayUpdatedAt: rowTs,
              },
            }
          : {
              $unset: { feishuRowNumber: "" },
              $set: { updatedAt: rowTs, displayUpdatedAt: rowTs },
            }
      );
      existingTasksByRecordId.set(recordId, {
        ...task,
        feishuRowNumber: nextRowNumber,
        updatedAt: rowTs,
        displayUpdatedAt: rowTs,
      });
      rowUpdatedCount++;
    }

    const eligibility = summarizeEligibility(records);
    const syncCandidates = records.filter((r) => !getRecordEligibilityIssue(r));

    log(
      `  同步规则：仅处理「是否需要自动化≠否」且「审批=通过」、非示例、已填所属店铺、已上传视频/图文内容的记录`
    );
    log(`  其中 ${syncCandidates.length} 条满足同步条件`);
    if (eligibility.skippedByIssue.size > 0) {
      const skippedText = Array.from(eligibility.skippedByIssue.entries())
        .map(([issue, count]) => `${issue} ${count} 条`)
        .join("，");
      log(`  已跳过 ${records.length - syncCandidates.length} 条：${skippedText}`);
    }

    if (syncCandidates.length === 0) {
      log(`${summaryPrefix} 没有满足同步条件的任务，退出。`);
      return {
        createdCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        backfilledHashCount: 0,
        skippedRemoteCreatedCount: 0,
        skippedRunningCount: 0,
        failedCount: 0,
        rowUpdatedCount,
      };
    }

    const feishuCfg = loadFeishuBitableConfigForProfile("task");
    const tokenCache = await getValidAccessToken(feishuCfg);
    const accessToken = tokenCache.accessToken;
    ensureDir(MATERIALS_DIR);

    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let backfilledHashCount = 0;
    let skippedRemoteCreatedCount = 0;
    let skippedRunningCount = 0;
    let failedCount = 0;

    for (const record of syncCandidates) {
      const snapshot = buildRecordSnapshot(record);
      const existingTask = existingTasksByRecordId.get(record.record_id || "");
      const label = `${snapshot.accountName} | ${snapshot.type} | ${snapshot.scheduleAt || "-"} | 第${rowNumberMap.get(record.record_id || "") || "-"}行`;

      if (existingTask?.status === "running") {
        log(`  ↺ 跳过运行中任务: ${label}（taskId=${existingTask.id}）`);
        skippedRunningCount++;
        continue;
      }

      if (snapshot.remoteCreatedStatus === "是") {
        skippedRemoteCreatedCount++;
        continue;
      }

      if (!existingTask && snapshot.remoteCreatedStatus !== "" && snapshot.remoteCreatedStatus !== "否") {
        skippedRemoteCreatedCount++;
        continue;
      }

      const contentHash = buildFeishuContentHash(snapshot);
      const syncState = getExistingTaskSyncState(existingTask, snapshot, contentHash);

      if (syncState.action === "skip-unchanged") {
        unchangedCount++;
        continue;
      }

      if (syncState.action === "backfill-hash-only") {
        const feishuRowNumber = rowNumberMap.get(record.record_id || "");
        await db.collection("creator_publish_tasks").updateOne(
          { id: existingTask.id },
          {
            $set: {
              feishuContentHash: contentHash,
              ...(feishuRowNumber ? { feishuRowNumber } : {}),
            },
            ...(feishuRowNumber ? {} : { $unset: { feishuRowNumber: "" } }),
          }
        );
        existingTasksByRecordId.set(record.record_id || "", {
          ...existingTask,
          feishuContentHash: contentHash,
          feishuRowNumber,
        });
        backfilledHashCount++;
        unchangedCount++;
        continue;
      }

      if (!existingTask) {
        if (!allowCreate) continue;
        log(`  + 新建任务: ${label}`);
      } else {
        log(`  * 检测到内容变化，准备更新任务: ${label}（taskId=${existingTask.id}）`);
      }

      try {
        const downloaded = [];
        for (const att of snapshot.attachments) {
          if (!att.file_token) continue;
          log(`    下载附件: ${att.name} (${(att.size / 1024).toFixed(0)} KB)`);
          const uniqueName = makeUniqueFileName(att.name, MATERIALS_DIR);
          const result = await downloadAttachment(
            feishuCfg,
            accessToken,
            att.file_token,
            MATERIALS_DIR,
            uniqueName
          );
          downloaded.push(result.fileName);
        }

        if (downloaded.length === 0) {
          log("    ⚠️ 没有可下载的附件，跳过");
          failedCount++;
          continue;
        }

        const payload = buildTaskPayload(snapshot, downloaded);
        const nowIso = new Date().toISOString();
        const feishuRowNumber = rowNumberMap.get(record.record_id || "");

        if (existingTask) {
          await db.collection("creator_publish_tasks").updateOne(
            { id: existingTask.id },
            {
              $set: {
                accountName: snapshot.accountName,
                status: "pending",
                payload,
                feishuRecordId: record.record_id || "",
                feishuContentHash: contentHash,
                updatedAt: nowIso,
                displayUpdatedAt: nowIso,
                ...(feishuRowNumber ? { feishuRowNumber } : {}),
              },
              $unset: {
                lastError: "",
                taskId: "",
                pid: "",
                workerId: "",
                ...(feishuRowNumber ? {} : { feishuRowNumber: "" }),
              },
            }
          );
          existingTasksByRecordId.set(record.record_id || "", {
            ...existingTask,
            accountName: snapshot.accountName,
            status: "pending",
            payload,
            feishuContentHash: contentHash,
            feishuRowNumber,
            updatedAt: nowIso,
            displayUpdatedAt: nowIso,
          });
          log(`    ✓ 已更新并重置为待执行: ${existingTask.id}`);
          updatedCount++;
        } else {
          const task = {
            id: generateTaskId(),
            createdAt: nowIso,
            updatedAt: nowIso,
            displayUpdatedAt: nowIso,
            accountName: snapshot.accountName,
            status: autoStart ? "queued" : "pending",
            feishuRecordId: record.record_id || "",
            feishuContentHash: contentHash,
            payload,
            ...(feishuRowNumber ? { feishuRowNumber } : {}),
          };
          await db.collection("creator_publish_tasks").insertOne({ ...task, _id: task.id });
          if (task.feishuRecordId) {
            existingTasksByRecordId.set(task.feishuRecordId, task);
          }
          log(`    ✓ 已创建任务: ${task.id}`);
          createdCount++;
        }

        // 如果正文被规范化了，同步回写到飞书表格
        if (snapshot.rawDescription && snapshot.rawDescription !== snapshot.description) {
          try {
            await updateBitableRecord(feishuCfg, accessToken, record.record_id, {
              正文: snapshot.description,
            });
            log(`    ↺ 已同步规范化正文到飞书`);
          } catch (wbErr) {
            log(`    ⚠️ 回写飞书正文失败: ${wbErr.message}`);
          }
        }
      } catch (e) {
        log(`    ❌ 同步失败: ${e.message}`);
        const f = record.fields || {};
        if (String(f["已创建任务"] || "").trim() === "是") {
          log("    ↺ 跳过飞书回写：已创建任务已为「是」");
        } else {
          try {
            await updateBitableRecord(
              feishuCfg,
              accessToken,
              record.record_id,
              { 已创建任务: formatImportErrorStatus(e) }
            );
            log("    ↺ 已回写飞书已创建任务列为失败原因");
          } catch (writebackError) {
            log(`    ⚠️ 回写飞书失败: ${writebackError.message}`);
          }
        }
        failedCount++;
      }
    }

    const summary = {
      createdCount,
      updatedCount,
      unchangedCount,
      backfilledHashCount,
      skippedRemoteCreatedCount,
      skippedRunningCount,
      failedCount,
      rowUpdatedCount,
    };

    log(
      `\n${summaryPrefix} 完成: 创建 ${createdCount}，更新 ${updatedCount}，无变化跳过 ${unchangedCount}（其中补摘要 ${backfilledHashCount}），远端已创建跳过 ${skippedRemoteCreatedCount}，运行中跳过 ${skippedRunningCount}，飞书行更新 ${rowUpdatedCount}，失败 ${failedCount}`
    );

    return summary;
  } finally {
    await client.close();
  }
}

module.exports = {
  syncPublishTasks,
};
