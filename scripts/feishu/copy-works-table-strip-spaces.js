#!/usr/bin/env node
/**
 * 从飞书多维表格「源表」读取全部记录，将指定字段（默认 作品名）去掉所有空白后，
 * 按目标表可写字段整表覆盖写入「目标表」（先清空目标表再批量新增）。
 *
 * 表 ID 等写在项目根 config.json → feishu.worksStripCopy
 *
 * 用法: node scripts/feishu/copy-works-table-strip-spaces.js [--dry-run]
 */
require("dotenv").config();

const fs = require("fs");
const { getProjectConfigPath } = require("../project-config-path");
const { loadFeishuConfig } = require("./lib/config");
const { getValidAccessToken } = require("./lib/oauth");
const {
  listBitableFields,
  listAllBitableRecords,
  listAllBitableRecordIds,
  batchDeleteBitableRecords,
  batchCreateBitableRecords
} = require("./lib/bitable");

const NON_WRITABLE_FIELD_TYPES = new Set([19, 20]);

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run" || a === "--dryRun") {
      result.dryRun = true;
    } else if (!a.startsWith("-")) {
      result._.push(a);
    }
  }
  return result;
}

function readWorksStripCopyConfig() {
  const cfgPath = getProjectConfigPath();
  const raw = fs.readFileSync(cfgPath, "utf8");
  const data = JSON.parse(raw);
  const c = data.feishu && data.feishu.worksStripCopy;
  if (!c || typeof c !== "object") {
    throw new Error(
      "请在 config.json 的 feishu.worksStripCopy 中配置 appToken、sourceTableId、targetTableId"
    );
  }
  const appToken = String(c.appToken || "").trim();
  const sourceTableId = String(c.sourceTableId || "").trim();
  const targetTableId = String(c.targetTableId || "").trim();
  const titleFieldName = String(c.titleFieldName || "作品名").trim() || "作品名";
  if (!appToken || !sourceTableId || !targetTableId) {
    throw new Error(
      "feishu.worksStripCopy 需提供 appToken、sourceTableId、targetTableId"
    );
  }
  return { appToken, sourceTableId, targetTableId, titleFieldName };
}

function coerceTextLikeForStrip(raw) {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string" || typeof raw === "number") {
    return String(raw);
  }
  if (Array.isArray(raw)) {
    if (
      raw.length > 0 &&
      raw.every((x) => typeof x === "string" && /^rec/i.test(String(x)))
    ) {
      return null;
    }
    const parts = [];
    for (const item of raw) {
      if (item != null && typeof item === "object" && typeof item.text === "string") {
        parts.push(item.text);
      } else if (typeof item === "string" || typeof item === "number") {
        parts.push(String(item));
      }
    }
    return parts.join("");
  }
  if (typeof raw === "object" && raw !== null && typeof raw.text === "string") {
    return raw.text;
  }
  return null;
}

function stripAllWhitespace(value) {
  return String(value ?? "").replace(/\s/g, "");
}

function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function buildWritableFieldSet(fieldMetas) {
  const set = new Set();
  for (const f of fieldMetas) {
    if (!f || typeof f !== "object") continue;
    const name = String(f.field_name || "").trim();
    if (!name) continue;
    if (NON_WRITABLE_FIELD_TYPES.has(f.type)) continue;
    set.add(name);
  }
  return set;
}

function filterAndStripFields(
  srcFields,
  destWritable,
  titleFieldName,
  titleFieldType
) {
  const out = {};
  if (!srcFields || typeof srcFields !== "object") return out;
  for (const [key, val] of Object.entries(srcFields)) {
    if (!destWritable.has(key)) continue;
    if (key === titleFieldName && titleFieldType !== 18) {
      const flat = coerceTextLikeForStrip(val);
      if (flat === null) {
        out[key] = val;
      } else {
        out[key] = stripAllWhitespace(flat);
      }
      continue;
    }
    out[key] = val;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args.dryRun);
  const { appToken, sourceTableId, targetTableId, titleFieldName } =
    readWorksStripCopyConfig();

  const baseConfig = loadFeishuConfig();
  const config = {
    ...baseConfig,
    bitableAppToken: appToken,
    bitableTableId: sourceTableId
  };

  const tokenRecord = await getValidAccessToken(baseConfig);

  console.log(
    `源表: ${sourceTableId} → 目标表: ${targetTableId}（作品名字段: ${titleFieldName}）` +
      (dryRun ? " [dry-run]" : "")
  );

  const [srcFieldsMeta, dstFieldsMeta] = await Promise.all([
    listBitableFields(config, tokenRecord.accessToken, sourceTableId),
    listBitableFields(config, tokenRecord.accessToken, targetTableId)
  ]);

  const destWritable = buildWritableFieldSet(dstFieldsMeta);
  const titleMeta = dstFieldsMeta.find(
    (f) => f && String(f.field_name || "").trim() === titleFieldName
  );
  const titleFieldType =
    titleMeta && typeof titleMeta.type === "number" ? titleMeta.type : 1;

  if (!destWritable.has(titleFieldName)) {
    console.warn(
      `警告: 目标表不存在可写字段「${titleFieldName}」，仍将复制其余可匹配列`
    );
  }

  const records = await listAllBitableRecords(
    config,
    tokenRecord.accessToken,
    sourceTableId
  );

  const payloads = [];
  for (const item of records) {
    const fields = item && item.fields;
    if (!fields || typeof fields !== "object") continue;
    const filtered = filterAndStripFields(
      fields,
      destWritable,
      titleFieldName,
      titleFieldType
    );
    if (Object.keys(filtered).length) {
      payloads.push({ fields: filtered });
    }
  }

  console.log(
    `源表记录: ${records.length} 条；可写入目标: ${payloads.length} 条（已按目标表可写字段过滤）`
  );

  if (dryRun) {
    const sample = payloads.slice(0, 2).map((p) => p.fields);
    console.log("dry-run 预览前 2 条 fields:", JSON.stringify(sample, null, 0));
    return;
  }

  const targetIds = await listAllBitableRecordIds(
    config,
    tokenRecord.accessToken,
    targetTableId
  );
  console.log(`目标表现有 ${targetIds.length} 条，开始清空…`);
  const delChunks = chunkArray(targetIds, 500);
  for (let i = 0; i < delChunks.length; i += 1) {
    await batchDeleteBitableRecords(
      config,
      tokenRecord.accessToken,
      delChunks[i],
      targetTableId
    );
    if (i < delChunks.length - 1) await sleepMs(200);
  }

  const BATCH = 500;
  const createChunks = chunkArray(payloads, BATCH);
  let created = 0;
  for (let i = 0; i < createChunks.length; i += 1) {
    await batchCreateBitableRecords(
      config,
      tokenRecord.accessToken,
      createChunks[i],
      targetTableId
    );
    created += createChunks[i].length;
    if (i < createChunks.length - 1) await sleepMs(200);
  }

  console.log(`完成: 已删除 ${targetIds.length} 条，已写入 ${created} 条`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
