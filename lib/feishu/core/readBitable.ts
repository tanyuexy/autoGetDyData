// @ts-nocheck
/**
 * 飞书多维表格读取工具 (可复用)
 *
 * 用法:
 *   import { readBitable } from "@/lib/feishu/core/readBitable";
 *   const data = await readBitable("task");
 *   // data = { fields: [...], records: [...], fieldMap: {...} }
 */
import { loadFeishuBitableConfigForProfile } from "./config";
import { getValidAccessToken } from "./oauth";
import { listBitableFields, listAllBitableRecords } from "./bitable";

const TYPE_MAP = {
  1: "文本",
  2: "数字",
  3: "单选",
  4: "多选",
  5: "日期",
  7: "复选框",
  11: "人员",
  13: "电话",
  15: "附件",
  17: "自动编号",
  18: "关联",
  19: "链接",
  20: "公式",
  21: "创建时间",
  22: "修改时间",
  23: "创建人",
  24: "修改人",
};

function buildFieldMap(fields) {
  const map = {};
  for (const f of fields) {
    map[f.field_id] = f;
  }
  return map;
}

function getFieldName(fieldMap, fieldId) {
  const info = fieldMap[fieldId];
  return info ? info.field_name : fieldId;
}

function getFieldType(fieldMap, fieldId) {
  const info = fieldMap[fieldId];
  return info ? info.type : null;
}

function getFieldTypeName(fieldMap, fieldId) {
  const type = getFieldType(fieldMap, fieldId);
  return TYPE_MAP[type] || `type-${type}`;
}

function formatAttachmentValue(value) {
  if (!Array.isArray(value)) return value;
  return value.map((att) => ({
    name: att.name,
    size: att.size,
    type: att.type,
    fileToken: att.file_token,
    downloadUrl: att.url,
  }));
}

function formatLinkValue(value) {
  if (!value) return value;
  if (typeof value === "string") return value;
  return { text: value.text, link: value.link, type: value.type };
}

function formatRelationValue(value) {
  if (!Array.isArray(value)) return value;
  return value.map((r) => ({
    text: r.text,
    tableId: r.table_id,
    recordIds: r.record_ids,
  }));
}

/**
 * 读取飞书多维表格的字段和记录
 * @param {string} profile - 飞书配置节名（如 "task", "creator", "shop"）
 * @param {object} [options]
 * @param {boolean} [options.recordsOnly] - 只读记录不读字段（默认 false）
 * @param {boolean} [options.fieldsOnly] - 只读字段不读记录（默认 false）
 * @returns {{ fields, records, fieldMap, fieldMapByName, config }}
 */
async function readBitable(profile, options = {}) {
  const cfg = loadFeishuBitableConfigForProfile(profile);
  const cache = await getValidAccessToken(cfg);
  const accessToken = cache.accessToken;

  let fields = [];
  let records = [];

  if (!options.recordsOnly) {
    fields = await listBitableFields(cfg, accessToken);
  }

  if (!options.fieldsOnly) {
    records = await listAllBitableRecords(cfg, accessToken);
  }

  const fieldMap = buildFieldMap(fields);
  const fieldMapByName = {};
  for (const f of fields) {
    fieldMapByName[f.field_name] = f;
  }

  return { fields, records, fieldMap, fieldMapByName, config: cfg };
}

export {
  readBitable,
  buildFieldMap,
  getFieldName,
  getFieldType,
  getFieldTypeName,
  formatAttachmentValue,
  formatLinkValue,
  formatRelationValue,
  TYPE_MAP,
};
