// @ts-nocheck
import fse from "fs-extra";
import dotenv from "dotenv";
import path from "node:path";
import crypto from "node:crypto";
import { MongoClient } from "mongodb";
import { readBitable } from "./core/readBitable";
import { downloadAttachment, updateBitableRecord } from "./core/bitable";
import { loadFeishuBitableConfigForProfile } from "./core/config";
import { getValidAccessToken } from "./core/oauth";
import {
  formatFeishuScheduleFailureStatus,
  validateScheduleAt,
} from "@/lib/publishScheduleValidation";

dotenv.config({ quiet: true });

const MATERIALS_DIR = path.resolve(
  process.cwd(),
  process.env.CREATOR_MATERIALS_DIR || "storage/creator-materials"
);

function ensureDir(dir) {
  fse.ensureDirSync(dir);
}

function generateTaskId() {
  return crypto.randomBytes(8).toString("hex");
}

function makeUniqueFileName(originalName, dir) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const candidates = new Set(fse.existsSync(dir) ? fse.readdirSync(dir) : []);
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
          lastError: 1,
          failureReason: 1,
          failureCategory: 1,
          failedStepTitle: 1,
          failedStepTag: 1,
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

/** 去掉 # 与标签名之间的空白，便于识别 `# 好物` 这类写法 */
function stripSpacesAfterHash(text) {
  return String(text || "").replace(/#(\s+)/g, "#");
}

/**
 * 与 scripts/douyin-creator/publish/editor.js 的 splitDescription 保持一致。
 * 从正文中提取 #话题，短话题（≤10字）从正文移除，长话题保留在正文中。
 */
function splitDescription(text) {
  const hashtags = [];
  const plainHashtags = [];

  let body = stripSpacesAfterHash(text)
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

async function writeFeishuScheduleImportFailure(feishuCfg, accessToken, record, errorText, log) {
  const f = record.fields || {};
  if (String(f["已创建任务"] || "").trim() === "是") {
    log("    ↺ 跳过飞书回写：已创建任务已为「是」");
    return;
  }
  try {
    await updateBitableRecord(feishuCfg, accessToken, record.record_id, {
      已创建任务: formatFeishuScheduleFailureStatus(errorText),
      审批: "异常待修改",
    });
    log("    ↺ 已回写飞书已创建任务列为失败原因（审批=异常待修改）");
  } catch (writebackError) {
    log(`    ⚠️ 回写飞书失败: ${writebackError.message}`);
  }
}

async function markExistingTaskScheduleFailed(db, existingTask, errorText, log) {
  if (!existingTask?.id) return;
  const nowIso = new Date().toISOString();
  await db.collection("creator_publish_tasks").updateOne(
    { id: existingTask.id },
    {
      $set: {
        status: "failed",
        lastError: errorText,
        updatedAt: nowIso,
        displayUpdatedAt: nowIso,
      },
      $unset: {
        taskId: "",
        pid: "",
        workerId: "",
      },
    }
  );
  log(`    ↺ 本地任务已标记失败: ${existingTask.id}`);
  return {
    ...existingTask,
    status: "failed",
    lastError: errorText,
    updatedAt: nowIso,
    displayUpdatedAt: nowIso,
  };
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
  const remoteCreatedStatus = getRemoteCreatedStatus(record);

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

function taskMaterialFileNames(task) {
  const payload = task?.payload || {};
  if (payload.type === "video") {
    return payload.videoFileKey ? [String(payload.videoFileKey)] : [];
  }
  if (payload.type === "article") {
    return Array.isArray(payload.imagesFileKeys)
      ? payload.imagesFileKeys.map((key) => String(key || "")).filter(Boolean)
      : [];
  }
  return [];
}

function snapshotAttachmentNames(snapshot) {
  return normalizeAttachmentSignature(snapshot.attachments)
    .map((att) => String(att.name || "").trim())
    .filter(Boolean);
}

function materialNamesMatch(existingTask, snapshot) {
  const currentNames = taskMaterialFileNames(existingTask);
  const nextNames = snapshotAttachmentNames(snapshot);
  if (currentNames.length !== nextNames.length) return false;
  return currentNames.every((name, index) => name === nextNames[index]);
}

function getExistingTaskSyncState(existingTask, snapshot, contentHash) {
  if (!existingTask) return { action: "create" };
  if (existingTask.status === "running") return { action: "skip-running" };
  if (snapshot.remoteCreatedStatus === "是") return { action: "skip-remote-created" };

  const taskContentHash = buildCoreContentHash(buildTaskComparableInput(existingTask));
  const snapshotContentHash = buildCoreContentHash(buildSnapshotComparableInput(snapshot));

  if (taskContentHash === snapshotContentHash) {
    if (existingTask.feishuContentHash === contentHash) {
      if (existingTask.status === "failed" && !materialNamesMatch(existingTask, snapshot)) {
        return { action: "update" };
      }
      return { action: "skip-unchanged" };
    }
    if (existingTask.feishuContentHash) {
      return { action: "update" };
    }
    return { action: "backfill-hash-only" };
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

function normalizeShopNameKey(name) {
  return String(name || "").replace(/\s+/g, "").trim();
}

function normalizeAutomationFlag(raw) {
  if (raw == null || raw === "") return "";
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((item) => normalizeAutomationFlag(item))
      .filter(Boolean)
      .join(",");
  }
  if (typeof raw === "object") {
    return String(raw.text ?? raw.name ?? "").trim();
  }
  return String(raw).trim();
}

/** 店铺信息表：店铺名 -> 是否需要自动化（是/否） */
function buildShopAutomationByNameMap(shopInfoRecords) {
  const map = new Map();
  for (const record of shopInfoRecords || []) {
    const fields = record.fields || {};
    const shopName = String(fields["店铺名"] || "").trim();
    if (!shopName) continue;
    map.set(normalizeShopNameKey(shopName), normalizeAutomationFlag(fields["是否需要自动化"]));
  }
  return map;
}

function extractTaskShopName(record) {
  const shop = record?.fields?.["所属店铺"];
  if (Array.isArray(shop) && shop[0]?.text) return String(shop[0].text).trim();
  if (typeof shop === "string") return shop.trim();
  return "";
}

function isShopAutomationDisabled(shopName, shopAutomationByName) {
  if (!shopName || !shopAutomationByName) return false;
  return shopAutomationByName.get(normalizeShopNameKey(shopName)) === "否";
}

function getRemoteCreatedStatus(record) {
  return String(record?.fields?.["已创建任务"] || "").trim();
}

function isRemoteCreatedDone(record) {
  return getRemoteCreatedStatus(record) === "是";
}

function getRecordEligibilityIssue(record, shopAutomationByName) {
  const f = record.fields || {};
  const approval = String(f["审批"] || "").trim();
  if (approval !== "通过") return `审批不是通过(${approval || "空"})`;
  const remark = String(f["备注"] || "").trim();
  if (remark === "示例") return "备注为示例";
  const shop = f["所属店铺"];
  if (!shop || !Array.isArray(shop) || !shop[0]?.text) return "缺少所属店铺";

  const taskShopName = extractTaskShopName(record);
  if (isShopAutomationDisabled(taskShopName, shopAutomationByName)) {
    return `店铺「${taskShopName}」在店铺信息表中是否需要自动化为否`;
  }

  const attachments = f["视频/图文内容"];
  if (!attachments || !Array.isArray(attachments) || !attachments.length) {
    return "缺少视频/图文内容";
  }
  return "";
}

function summarizeEligibility(records, shopAutomationByName) {
  const stats = {
    eligible: 0,
    skippedByIssue: new Map(),
  };

  for (const record of records) {
    const issue = getRecordEligibilityIssue(record, shopAutomationByName);
    if (!issue) {
      stats.eligible++;
      continue;
    }
    stats.skippedByIssue.set(issue, (stats.skippedByIssue.get(issue) || 0) + 1);
  }

  return stats;
}

function isExcludedAutoRetryFailure(task) {
  const text = [
    task?.lastError,
    task?.failureReason,
    task?.failureCategory,
    task?.failedStepTitle,
    task?.failedStepTag,
  ].filter(Boolean).join(" ");
  return /购物车限额|购物车限购|定时时间不满足平台要求/.test(text);
}

function shouldQueueExistingTaskOnAutoStart(task) {
  if (task?.status === "pending" || task?.status === "cancelled") return true;
  if (task?.status === "failed") return !isExcludedAutoRetryFailure(task);
  return false;
}

async function queueAutoRetryableFailedTasks(db, options = {}) {
  const logger = options.logger || console.log;
  const log = (...args) => logger(...args);
  const nowIso = new Date().toISOString();
  const failedTasks = await db
    .collection("creator_publish_tasks")
    .find(
      { status: "failed" },
      {
        projection: {
          id: 1,
          accountName: 1,
          lastError: 1,
          failureReason: 1,
          failureCategory: 1,
          failedStepTitle: 1,
          failedStepTag: 1,
        },
      }
    )
    .toArray();

  let queuedCount = 0;
  let skippedExcludedCount = 0;
  for (const task of failedTasks) {
    if (isExcludedAutoRetryFailure(task)) {
      skippedExcludedCount++;
      continue;
    }
    await db.collection("creator_publish_tasks").updateOne(
      { id: task.id, status: "failed" },
      {
        $set: {
          status: "queued",
          updatedAt: nowIso,
          displayUpdatedAt: nowIso,
        },
        $unset: {
          lastError: "",
          taskId: "",
          pid: "",
          workerId: "",
        },
      }
    );
    queuedCount++;
    log(`  → 可重试失败任务加入执行队列: ${task.accountName || "-"}（taskId=${task.id}）`);
  }

  if (failedTasks.length > 0) {
    log(
      `  失败任务自动重试扫描完成：入队 ${queuedCount}，排除 ${skippedExcludedCount}（购物车限额/限购或定时时间不满足平台要求）`
    );
  }

  return { queuedCount, skippedExcludedCount, scannedCount: failedTasks.length };
}

async function queueAutoRetryableFailedPublishTasks(options = {}) {
  const { client, db } = await getMongoDb();
  try {
    return await queueAutoRetryableFailedTasks(db, options);
  } finally {
    await client.close();
  }
}

/** 轻量预检：满足导入前置条件的飞书任务行数（不读 Mongo、不下载附件） */
async function peekFeishuSyncCandidates(options = {}) {
  const logger = options.logger || console.log;
  const log = (...args) => logger(...args);
  const summaryPrefix = options.summaryPrefix || "[peek-feishu-sync]";

  log(`${summaryPrefix} 预检飞书任务表同步条件...`);
  const { records } = await readBitable("task");
  const { records: shopInfoRecords } = await readBitable("shopInfo", { recordsOnly: true });
  const shopAutomationByName = buildShopAutomationByNameMap(shopInfoRecords);
  const eligibleRecords = records.filter(
    (record) => !getRecordEligibilityIssue(record, shopAutomationByName)
  );
  const remoteCreatedSkipCount = eligibleRecords.filter((record) =>
    isRemoteCreatedDone(record)
  ).length;
  const syncCandidates = eligibleRecords.filter((record) => !isRemoteCreatedDone(record));
  const eligibility = summarizeEligibility(records, shopAutomationByName);

  log(
    `  任务表 ${records.length} 条，满足同步条件 ${eligibleRecords.length} 条` +
      `，排除飞书已创建任务=是 ${remoteCreatedSkipCount} 条，待导入预检 ${syncCandidates.length} 条`
  );

  return {
    totalRecords: records.length,
    syncCandidateCount: syncCandidates.length,
    syncCandidateRecordIds: syncCandidates
      .map((record) => String(record.record_id || "").trim())
      .filter(Boolean),
    eligibleCount: eligibility.eligible,
    remoteCreatedSkipCount,
  };
}

async function syncPublishTasks(options = {}) {
  const {
    autoStart = false,
    allowCreate = true,
    logger = console.log,
    summaryPrefix = "[sync-publish-tasks]",
    verbose = false,
  } = options;

  const log = (...args) => logger(...args);
  const debug = (...args) => {
    if (verbose) log(...args);
  };

  const { client, db } = await getMongoDb();
  try {
    log(`${summaryPrefix} 开始导入发布任务...`);
    if (autoStart && allowCreate) {
      log(`  模式：导入后自动加入队列`);
    }

    const existingTasksByRecordId = await loadExistingTasksByFeishuRecordId(db);
    if (existingTasksByRecordId.size > 0) {
      debug(`  Mongo 已有 ${existingTasksByRecordId.size} 个飞书导入任务，将执行增量同步`);
    }

    const { records } = await readBitable("task");
    debug(`  找到 ${records.length} 条任务表记录`);

    debug(`${summaryPrefix} 读取店铺信息表（按店铺名匹配是否需要自动化）...`);
    const { records: shopInfoRecords } = await readBitable("shopInfo", { recordsOnly: true });
    const shopAutomationByName = buildShopAutomationByNameMap(shopInfoRecords);
    const disabledShopNames = [];
    for (const record of shopInfoRecords || []) {
      const shopName = String(record.fields?.["店铺名"] || "").trim();
      if (shopName && shopAutomationByName.get(normalizeShopNameKey(shopName)) === "否") {
        disabledShopNames.push(shopName);
      }
    }
    debug(
      `  店铺信息表 ${shopInfoRecords.length} 条，其中是否需要自动化=否 的店铺 ${disabledShopNames.length} 个` +
        (disabledShopNames.length ? `：${disabledShopNames.join("、")}` : "")
    );

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

    const eligibility = summarizeEligibility(records, shopAutomationByName);
    const syncCandidates = records.filter(
      (r) => !getRecordEligibilityIssue(r, shopAutomationByName)
    );

    debug(
      `  同步规则：任务表「所属店铺」与店铺信息表「店铺名」一致且该店是否需要自动化=否 则跳过；另需审批=通过、非示例、已填所属店铺、已上传视频/图文内容`
    );
    log(`  候选：待处理 ${syncCandidates.length} 条 / 总 ${records.length} 条`);
    if (eligibility.skippedByIssue.size > 0) {
      const skippedText = Array.from(eligibility.skippedByIssue.entries())
        .map(([issue, count]) => `${issue} ${count} 条`)
        .join("，");
      debug(`  已跳过 ${records.length - syncCandidates.length} 条：${skippedText}`);
    }

    if (syncCandidates.length === 0) {
      log(`${summaryPrefix} 没有满足同步条件的飞书任务，退出。`);
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
    let skippedScheduleInvalidCount = 0;
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

      if (snapshot.scheduleAt) {
        const scheduleValidation = validateScheduleAt(snapshot.scheduleAt);
        if (!scheduleValidation.ok) {
          log(`  ⚠️ 跳过导入（定时时间不满足平台要求）: ${label}`);
          log(`    ${scheduleValidation.error}`);
          await writeFeishuScheduleImportFailure(
            feishuCfg,
            accessToken,
            record,
            scheduleValidation.error,
            log
          );
          const failedTask = await markExistingTaskScheduleFailed(
            db,
            existingTask,
            scheduleValidation.error,
            log
          );
          if (failedTask && record.record_id) {
            existingTasksByRecordId.set(String(record.record_id), failedTask);
          }
          skippedScheduleInvalidCount++;
          continue;
        }
      }

      const contentHash = buildFeishuContentHash(snapshot);
      const syncState = getExistingTaskSyncState(existingTask, snapshot, contentHash);

      if (syncState.action === "skip-unchanged") {
        if (autoStart && shouldQueueExistingTaskOnAutoStart(existingTask)) {
          const queuedAt = new Date().toISOString();
          await db.collection("creator_publish_tasks").updateOne(
            { id: existingTask.id },
            {
              $set: {
                status: "queued",
                updatedAt: queuedAt,
                displayUpdatedAt: queuedAt,
              },
              $unset: {
                lastError: "",
                taskId: "",
                pid: "",
                workerId: "",
              },
            }
          );
          existingTasksByRecordId.set(record.record_id || "", {
            ...existingTask,
            status: "queued",
            updatedAt: queuedAt,
            displayUpdatedAt: queuedAt,
          });
          log(`  → 已有任务加入执行队列: ${label}（taskId=${existingTask.id}，原状态=${existingTask.status}）`);
        }
        unchangedCount++;
        continue;
      }

      if (syncState.action === "backfill-hash-only") {
        const feishuRowNumber = rowNumberMap.get(record.record_id || "");
        const shouldQueueExisting = autoStart && shouldQueueExistingTaskOnAutoStart(existingTask);
        const originalStatus = existingTask.status;
        const queuedAt = shouldQueueExisting ? new Date().toISOString() : "";
        await db.collection("creator_publish_tasks").updateOne(
          { id: existingTask.id },
          {
            $set: {
              feishuContentHash: contentHash,
              ...(shouldQueueExisting
                ? { status: "queued", updatedAt: queuedAt, displayUpdatedAt: queuedAt }
                : {}),
              ...(feishuRowNumber ? { feishuRowNumber } : {}),
            },
            ...(feishuRowNumber && !shouldQueueExisting
              ? {}
              : {
                  $unset: {
                    ...(feishuRowNumber ? {} : { feishuRowNumber: "" }),
                    ...(shouldQueueExisting
                      ? { lastError: "", taskId: "", pid: "", workerId: "" }
                      : {}),
                  },
                }),
          }
        );
        existingTasksByRecordId.set(record.record_id || "", {
          ...existingTask,
          feishuContentHash: contentHash,
          feishuRowNumber,
          ...(shouldQueueExisting
            ? { status: "queued", updatedAt: queuedAt, displayUpdatedAt: queuedAt }
            : {}),
        });
        if (shouldQueueExisting) {
          log(`  → 已有任务加入执行队列: ${label}（taskId=${existingTask.id}，原状态=${originalStatus}）`);
        }
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
        const nextStatus = autoStart ? "queued" : "pending";

        if (existingTask) {
          await db.collection("creator_publish_tasks").updateOne(
            { id: existingTask.id },
            {
              $set: {
                accountName: snapshot.accountName,
                status: nextStatus,
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
            status: nextStatus,
            payload,
            feishuContentHash: contentHash,
            feishuRowNumber,
            updatedAt: nowIso,
            displayUpdatedAt: nowIso,
          });
          log(
            autoStart
              ? `    ✓ 已更新并加入执行队列: ${existingTask.id}`
              : `    ✓ 已更新并重置为待执行: ${existingTask.id}`
          );
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
      skippedScheduleInvalidCount,
      failedCount,
      rowUpdatedCount,
    };

    log(
      `${summaryPrefix} 完成：创建 ${createdCount}，更新 ${updatedCount}，入队/无变化 ${unchangedCount}，飞书已创建跳过 ${skippedRemoteCreatedCount}，运行中跳过 ${skippedRunningCount}，定时无效跳过 ${skippedScheduleInvalidCount}，失败 ${failedCount}` +
        (backfilledHashCount ? `，补摘要 ${backfilledHashCount}` : "") +
        (rowUpdatedCount ? `，行号更新 ${rowUpdatedCount}` : "")
    );

    return summary;
  } finally {
    await client.close();
  }
}

export {
  syncPublishTasks,
  peekFeishuSyncCandidates,
  queueAutoRetryableFailedPublishTasks,
};
