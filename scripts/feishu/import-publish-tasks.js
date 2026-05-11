/**
 * 从飞书 task 表读取数据 → 创建发布任务
 *
 * 用法:
 *   node scripts/feishu/import-publish-tasks.js
 *
 * 筛选规则:
 *   - 审批 == "通过"（只导入审核通过的行）
 *   - 已创建任务 为空或 "否"（只导入飞书侧未创建的行）
 *   - 备注 != "示例"（跳过示例行）
 *   - 必须有 所属店铺 + 视频/图文内容（核心字段）
 *   - Mongo 去重：如果 creator_publish_tasks 中已有相同 feishuRecordId 的任务则跳过
 *
 * 注意：
 *   - 导入创建失败时，会将失败原因回写到飞书「已创建任务」列。
 *   - 发布成功后由 mark-task-published.js 回写「已创建任务=是」。
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const { readBitable } = require("./lib/readBitable");
const { downloadAttachment, updateBitableRecord } = require("./lib/bitable");
const { loadFeishuBitableConfigForProfile } = require("./lib/config");
const { getValidAccessToken } = require("./lib/oauth");

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
  const candidates = new Set(
    fs.existsSync(dir) ? fs.readdirSync(dir) : []
  );
  let name = originalName;
  let i = 1;
  while (candidates.has(name)) {
    name = `${base}-${i}${ext}`;
    i++;
  }
  return name;
}

/**
 * 读取已有任务中的 feishuRecordId 集合，用于去重
 */
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

async function loadExistingFeishuRecordIds(db) {
  const docs = await db
    .collection("creator_publish_tasks")
    .find({ feishuRecordId: { $exists: true, $ne: "" } }, { projection: { feishuRecordId: 1 } })
    .toArray();
  return new Set(docs.map((doc) => doc.feishuRecordId).filter(Boolean));
}

/**
 * 解析正文字段：第一行为描述，其余行为话题标签
 * 话题以 # 开头，直接拼接（话题添加时会逐个识别并点添加话题按钮转换）
 */
function parseBodyAndHashtags(raw) {
  if (!raw) return { description: "", hashtags: "" };
  const lines = String(raw).split("\n").map((s) => s.trim()).filter(Boolean);
  const description = lines[0] || "";
  const hashtagLine = lines.slice(1).join(" ");
  const hashtags = hashtagLine
    .split("#")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => "#" + s)
    .join("");
  return { description, hashtags };
}

/**
 * 推断发布类型：有视频附件 → video，纯图片 → article
 */
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

async function main() {
  console.log("[import-publish-tasks] 开始从飞书读取任务表...");
  const autoStart = process.argv.includes("--auto-start");
  if (autoStart) {
    console.log("[import-publish-tasks] 已启用 auto-start，新导入任务将直接进入队列");
  }

  const { client, db } = await getMongoDb();

  // 读取 Mongo 已有任务的 feishuRecordId 集合用于去重
  const existingIds = await loadExistingFeishuRecordIds(db);
  if (existingIds.size > 0) {
    console.log(`  Mongo 已有 ${existingIds.size} 个飞书导入任务，将跳过重复`);
  }

  const { records, fieldMapByName } = await readBitable("task");

  // 筛选待处理的行
  const pending = records.filter((r) => {
    const f = r.fields;
    const approval = String(f["审批"] || "").trim();
    if (approval !== "通过") return false;
    const remark = String(f["备注"] || "").trim();
    if (remark === "示例") return false;
    // 只允许空值或“否”，其余状态（如“是”“是/否”）都跳过
    const status = String(f["已创建任务"] || "").trim();
    if (status !== "" && status !== "否") return false;
    // 本地去重：已有相同 record_id 的任务
    if (existingIds.has(r.record_id || "")) return false;
    const shop = f["所属店铺"];
    if (!shop || !Array.isArray(shop) || !shop[0]?.text) return false;
    const attachments = f["视频/图文内容"];
    if (!attachments || !Array.isArray(attachments) || !attachments.length) return false;
    return true;
  });

  console.log(`  找到 ${records.length} 条记录，其中 ${pending.length} 条待导入`);

  if (pending.length === 0) {
    console.log("[import-publish-tasks] 没有待导入的任务，退出。");
    await client.close();
    return;
  }

  // 获取 feishu task 表配置用于下载附件
  const feishuCfg = loadFeishuBitableConfigForProfile("task");
  const tokenCache = await getValidAccessToken(feishuCfg);
  const accessToken = tokenCache.accessToken;

  ensureDir(MATERIALS_DIR);

  let createdCount = 0;
  let failedCount = 0;

  for (const record of pending) {
    const f = record.fields;
    const accountName = f["所属店铺"]?.[0]?.text || "";
    const attachments = f["视频/图文内容"] || [];
    const linkField = f["挂车链接"];
    const productLink = Array.isArray(linkField) ? (linkField[0]?.link || "") : "";
    const productNameField = f["挂车产品名"];
    const productTitle = Array.isArray(productNameField)
      ? (productNameField[0]?.text || "")
      : "";
    // 标题：来自「标题（可为空）」字段，可为空
    const title = String(f["标题（可为空）"] || "").trim();
    // 正文：第一行为描述，其余行为话题标签
    const { description, hashtags } = parseBodyAndHashtags(f["正文"]);
    // 描述末尾拼接话题
    const fullDescription = [description, hashtags].filter(Boolean).join("\n\n");
    const isAiContent = String(f["ai内容"] || "").trim() === "是";
    const scheduleRaw = f["计划发布时间"];
    const scheduleAt = parseScheduleAt(scheduleRaw);
    const type = inferType(attachments);

    console.log(`\n  处理: ${accountName} | ${type} | "${title}"`);
    console.log("    计划发布时间原始值:", scheduleRaw);
    console.log("    计划发布时间原始值类型:", Array.isArray(scheduleRaw) ? "array" : typeof scheduleRaw);
    console.log("    计划发布时间解析结果 scheduleAt:", scheduleAt);

    try {
      // 下载附件（处理同名冲突：自动加序号后缀）
      const downloaded = [];
      for (const att of attachments) {
        if (!att.file_token) continue;
        console.log(`    下载附件: ${att.name} (${(att.size / 1024).toFixed(0)} KB)`);
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
        console.log(`    ⚠️ 没有可下载的附件，跳过`);
        failedCount++;
        continue;
      }

      // 构建任务（包含 feishuRecordId 供发布后回写）
      const task = {
        id: generateTaskId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        accountName,
        status: autoStart ? "queued" : "pending",
        feishuRecordId: record.record_id || "",
        payload: {
          type,
          title,
          description: fullDescription,
          isAiContent,
          scheduleAt,
          ...(productLink
            ? {
                productTitle: productTitle || "还少胶囊",
                approvalNumber: "不包含广审内容",
                productLink,
              }
            : {}),
          ...(type === "video"
            ? { videoFileKey: downloaded[0] }
            : { imagesFileKeys: downloaded }),
        },
      };

      await db.collection("creator_publish_tasks").updateOne(
        {
          $or: [
            { id: task.id },
            ...(task.feishuRecordId ? [{ feishuRecordId: task.feishuRecordId }] : []),
          ],
        },
        { $setOnInsert: { ...task, _id: task.id } },
        { upsert: true }
      );
      if (task.feishuRecordId) existingIds.add(task.feishuRecordId);

      console.log(`    ✓ 已创建任务 ${task.id}（feishuRecordId: ${record.record_id}）`);

      createdCount++;
    } catch (e) {
      console.log(`    ❌ 失败: ${e.message}`);
      try {
        await updateBitableRecord(
          feishuCfg,
          accessToken,
          record.record_id,
          { 已创建任务: formatImportErrorStatus(e) }
        );
        console.log("    ↺ 已回写飞书已创建任务列为失败原因");
      } catch (writebackError) {
        console.log(`    ⚠️ 回写飞书失败: ${writebackError.message}`);
      }
      failedCount++;
    }
  }

  console.log(
    `\n[import-publish-tasks] 完成: 创建 ${createdCount}，失败 ${failedCount}`
  );

  await client.close();
}

main().catch((e) => {
  console.error("[import-publish-tasks] 执行失败:", e.message);
  process.exitCode = 1;
});
