#!/usr/bin/env node
require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const XLSX = require("xlsx");
const {
  loadFeishuConfig,
  loadFeishuBitableConfigForProfile,
  optionalEnv
} = require("./lib/config");
const {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  writeTokenCache,
  readTokenCache,
  getValidAccessToken
} = require("./lib/oauth");
const {
  createBitableRecord,
  listBitableFields,
  listAllBitableRecords,
  listAllBitableRecordIds,
  batchDeleteBitableRecords,
  batchCreateBitableRecords,
  batchUpdateBitableRecords
} = require("./lib/bitable");

const DEFAULT_XLSX_FIELD_ALIASES = {
  作品名称: "作品名",
  "5s完播率": "5秒完播率",
  "2s跳出率": "2秒跳出率",
  平均播放时长: "平播时长",
  主页访问量: "主页访量",
  粉丝增量: "增粉"
};

/** 抖店「每日支付增量汇总」xlsx 列名 -> 多维表格字段名（需在 shop 表中存在） */
const SHOP_XLSX_FIELD_ALIASES = {
  作品标题: "作品名",
  用户支付金额: "增加销售额",
  数据日期: "日期"
};

const { existsSync } = require("fs");
const { readProjectConfigFromEnv } = require("../common/project-config");

function getDefaultExportsDir() {
  const envVal = process.env.EXPORTS_DIR;
  if (envVal) return envVal;
  const newPath = path.resolve(process.cwd(), "storage/exports");
  const oldPath = path.resolve(process.cwd(), "data");
  if (existsSync(oldPath) && !existsSync(newPath)) {
    console.warn("[migration] 正在使用旧目录 \"data/\"，建议移动到 \"storage/exports/\" 或设置 EXPORTS_DIR");
    return "data";
  }
  return "storage/exports";
}

const SHOP_DEFAULT_XLSX_RELATIVE = path.join(
  getDefaultExportsDir(),
  "抖店-全部店铺-每日支付增量汇总.xlsx"
);

/** sync-data-xlsx 未指定 --file 时，按 FEISHU_BITABLE_PROFILE 只在该前缀的 xlsx 中选修改时间最新的 */
const DEFAULT_XLSX_NAME_PREFIX_BY_PROFILE = {
  creator: "抖创",
  shop: "抖店"
};
const NON_WRITABLE_FIELD_TYPES = new Set([19, 20]);

function printHelp() {
  console.log(`
飞书多维表格 OAuth2 工具

用法:
  node scripts/feishu/cli.js auth-url [--state xxx] [--no-open]
  npm run feishu:callback
  node scripts/feishu/cli.js exchange --code <authorization_code>
  node scripts/feishu/cli.js refresh
  node scripts/feishu/cli.js insert --fields '{"姓名":"张三","金额":100}'
  node scripts/feishu/cli.js insert --fields-file ./data/record.json
  node scripts/feishu/cli.js insert-xlsx --file ./data/作品列表.xlsx [--sheet Sheet1] [--dry-run]
  node scripts/feishu/cli.js sync-data-xlsx [--dir ./data] [--file ./data/某.xlsx] [--sheet Sheet1] [--keep-rows N] [--dry-run]
  node scripts/feishu/cli.js sync-data-xlsx-shop [--file ./data/抖店-全部店铺-每日支付增量汇总.xlsx] [--sheet Sheet1] [--replace] [--dry-run]
  node scripts/feishu/cli.js backup-bitable [--dir ./data] [--profiles creator,shop] [--dry-run]

说明:
  - OAuth token 默认写入 storage/feishu/token-cache.json（可用 FEISHU_OAUTH_TOKEN_CACHE 覆盖）；若仅有旧路径 scripts/feishu/token-cache.json，首次运行会自动复制到新路径
  - 多维表格 appToken/tableId：优先读环境变量 FEISHU_BITABLE_*；未设置时读 Mongo app_config 的 feishu.<profile>（默认 profile=shop，抖创同步可设 FEISHU_BITABLE_PROFILE=creator 并在 Mongo 配置 feishu.creator）
  - auth-url: 生成 OAuth 授权地址（默认自动拉起浏览器，可用 --no-open 关闭）
  - feishu:callback: 启动本地回调服务，自动 exchange 并保存 token
  - exchange: 用回调 code 换取 access_token/refresh_token 并写入本地缓存
  - refresh: 强制刷新 access_token
  - insert: 自动检查/刷新 token 后插入一条多维表格记录
  - insert-xlsx: 读取 xlsx 第一行作为字段名，按行写入飞书多维表格（追加）
  - sync-data-xlsx: 未指定 --file 时，在指定目录下按 FEISHU_BITABLE_PROFILE 选取文件名前缀（creator=抖创、shop=抖店）匹配且「修改时间最新」的 xlsx；可用 --file 覆盖；默认先清空当前飞书表全部记录再批量写入；可用 --keep-rows N 保留「列出记录」接口顺序下的前 N 条，仅删除之后的记录再写入（不清空整张表）
   - sync-data-xlsx-shop: 抖店汇总表同步到 feishu.shop 表；默认读取 ${SHOP_DEFAULT_XLSX_RELATIVE}（列为数据来源、所属店铺、作品名、日期、成交类型、增加销售额；飞书会忽略本地表中无对应字段的列）；缺列时仍可映射：作品标题→作品名、用户支付金额→增加销售额、数据日期→日期；默认追加模式：按「作品名+日期+增加销售额」三字段匹配已有记录，匹配到则补全空字段，未匹配则新增行；加 --replace 则先删后写（可用 --keep-rows）
  - backup-bitable: 从飞书多维表格拉取当前表全部记录并导出为 xlsx（默认各一份固定文件名，覆盖写入）：data/抖创-飞书表备份.xlsx、data/抖店-飞书表备份.xlsx；此类文件名不会被 sync-data-xlsx 的「按前缀选最新 xlsx」选中；未传 --profiles 时默认 creator,shop
`);
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current.startsWith("--")) {
      const key = current.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        result[key] = true;
      } else {
        result[key] = next;
        i += 1;
      }
    } else {
      result._.push(current);
    }
  }
  return result;
}

function readOption(args, ...keys) {
  for (const key of keys) {
    if (args[key] !== undefined) return args[key];
  }
  return undefined;
}

function ensureConfigValue(config, key, envName) {
  const value = config[key];
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`缺少环境变量: ${envName}`);
  }
}

function shouldAutoOpenAuthUrl(args) {
  const explicitNoOpen = Boolean(readOption(args, "no-open", "noOpen"));
  if (explicitNoOpen) return false;
  const explicitOpen = Boolean(readOption(args, "open"));
  if (explicitOpen) return true;
  const envAutoOpen = optionalEnv("FEISHU_OAUTH_AUTH_URL_AUTO_OPEN", "true")
    .trim()
    .toLowerCase();
  return envAutoOpen !== "false";
}

function openUrlInDefaultBrowser(url) {
  return new Promise((resolve, reject) => {
    let cmd = "";
    let args = [];

    if (process.platform === "darwin") {
      cmd = "open";
      args = [url];
    } else if (process.platform === "win32") {
      cmd = "cmd";
      args = ["/c", "start", "", url];
    } else {
      cmd = "xdg-open";
      args = [url];
    }

    const child = spawn(cmd, args, {
      stdio: "ignore",
      detached: true
    });
    child.on("error", reject);
    child.unref();
    resolve();
  });
}

async function readFieldsFromArgs(args) {
  const fieldsFile = readOption(args, "fields-file", "fieldsFile");
  if (fieldsFile) {
    const raw = await fs.readFile(
      path.resolve(process.cwd(), fieldsFile),
      "utf8"
    );
    return JSON.parse(raw);
  }
  const inlineFields = readOption(args, "fields");
  if (inlineFields) {
    return JSON.parse(inlineFields);
  }
  const envFields = optionalEnv("FEISHU_INSERT_FIELDS_JSON", "");
  if (envFields) {
    return JSON.parse(envFields);
  }
  throw new Error(
    "请提供 --fields 或 --fields-file，或设置 FEISHU_INSERT_FIELDS_JSON"
  );
}

function toPositiveInteger(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

/** 0 合法：表示不保留（与未传参一致） */
function toNonNegativeInteger(value, fallback = 0) {
  if (typeof value === "boolean") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

function readProfileKeepRowsFromProjectConfig(profile) {
  try {
    const data = readProjectConfigFromEnv();
    const key = String(profile || "shop").trim() || "shop";
    const value = data && data.feishu && data.feishu[key] && data.feishu[key].keepRows;
    if (value === undefined || value === null || value === "") return undefined;
    return toNonNegativeInteger(value, 0);
  } catch {
    return undefined;
  }
}

function toNumberOrNull(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const normalized = text.replace(/,/g, "");
  const isPercent = normalized.endsWith("%");
  const raw = isPercent ? normalized.slice(0, -1).trim() : normalized;
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return isPercent ? num / 100 : num;
}

function toDateTimestampOrNull(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  // 优先兼容 "YYYY-MM-DD HH:mm:ss" 这类格式
  const normalized = text.replace(/\//g, "-").replace(" ", "T");
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function isEmptyCellValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  return value.trim() === "";
}

function parseXlsxRows(filePath, sheetName = "") {
  const workbook = XLSX.readFile(filePath, {
    cellDates: true
  });

  const targetSheetName =
    String(sheetName || "").trim() || workbook.SheetNames[0];
  if (!targetSheetName) {
    throw new Error("xlsx 文件中没有可用的 sheet");
  }

  const worksheet = workbook.Sheets[targetSheetName];
  if (!worksheet) {
    throw new Error(`未找到 sheet: ${targetSheetName}`);
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: null
  });

  if (!rows.length) {
    throw new Error("xlsx sheet 没有数据");
  }

  const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
  const headers = headerRow.map((item) => String(item || "").trim());
  const validColumns = headers
    .map((name, index) => ({ name, index }))
    .filter((column) => column.name);

  if (!validColumns.length) {
    throw new Error("xlsx 第一行没有可用字段名");
  }

  const records = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const fields = {};

    for (const column of validColumns) {
      const cellValue = row[column.index];
      if (isEmptyCellValue(cellValue)) continue;
      fields[column.name] = cellValue;
    }

    if (!Object.keys(fields).length) continue;
    records.push({
      rowNumber: rowIndex + 1,
      fields
    });
  }

  return {
    sheetName: targetSheetName,
    headers: validColumns.map((item) => item.name),
    records
  };
}

function readXlsxFieldAliases(args) {
  const option = readOption(args, "field-aliases", "fieldAliases");
  if (!option) return { ...DEFAULT_XLSX_FIELD_ALIASES };
  let parsed = {};
  try {
    parsed = JSON.parse(String(option));
  } catch (error) {
    throw new Error("--field-aliases 必须是 JSON 对象");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--field-aliases 必须是 JSON 对象");
  }
  return {
    ...DEFAULT_XLSX_FIELD_ALIASES,
    ...parsed
  };
}

function readShopXlsxFieldAliases(args) {
  const option = readOption(args, "field-aliases", "fieldAliases");
  let parsed = {};
  if (option) {
    try {
      parsed = JSON.parse(String(option));
    } catch (error) {
      throw new Error("--field-aliases 必须是 JSON 对象");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("--field-aliases 必须是 JSON 对象");
    }
  }
  return {
    ...SHOP_XLSX_FIELD_ALIASES,
    ...parsed
  };
}

function chunkArray(items, chunkSize) {
  if (chunkSize <= 0) {
    throw new Error("chunkSize 必须大于 0");
  }
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 飞书表本地备份文件名，勿与业务总表混用；sync 按前缀选「最新 xlsx」时会跳过 */
function isFeishuBitableBackupXlsxFileName(fileName) {
  return String(fileName || "").includes("飞书表备份");
}

async function findLatestXlsxFile(relativeDir, namePrefix = "") {
  const dirPath = path.resolve(
    process.cwd(),
    String(relativeDir || getDefaultExportsDir()).trim()
  );
  const prefix = String(namePrefix || "").trim();
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  let bestFull = "";
  let bestMtime = 0;
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith(".xlsx")) continue;
    if (isFeishuBitableBackupXlsxFileName(ent.name)) continue;
    if (prefix && !ent.name.startsWith(prefix)) continue;
    const full = path.join(dirPath, ent.name);
    const st = await fs.stat(full);
    if (!bestFull || st.mtimeMs > bestMtime) {
      bestFull = full;
      bestMtime = st.mtimeMs;
    }
  }
  if (!bestFull) {
    const hint = prefix
      ? `目录下没有以「${prefix}」开头的 .xlsx: ${dirPath}`
      : `目录下没有 .xlsx: ${dirPath}`;
    throw new Error(hint);
  }
  return bestFull;
}

function defaultXlsxNamePrefixForSync() {
  const profile = optionalEnv("FEISHU_BITABLE_PROFILE", "shop");
  return DEFAULT_XLSX_NAME_PREFIX_BY_PROFILE[profile] || "";
}

function normalizeLookupKey(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** 去重辅助：标准化作名（去空格、小写） */
function normalizeDedupKey(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim().replace(/\s+/g, "").toLowerCase();
}

/** 去重辅助：标准化日期，兼容 timestamp（飞书返回）和字符串格式 */
function normalizeDedupDate(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e15 ? value / 1000 : value;
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}/${m}/${day}`;
  }
  const s = String(value).trim();
  if (!s) return "";
  const m = s.match(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (m) {
    return `${m[1]}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}`;
  }
  return s;
}

function normalizeDedupAmount(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "";
  }
  const s = String(value).trim().replace(/,/g, "");
  if (!s) return "";
  const n = Number(s);
  if (Number.isFinite(n)) {
    return String(Math.round(n * 100) / 100);
  }
  return s;
}

function makeShopDedupKey(fields) {
  const title = normalizeDedupKey(fields && fields["作品名"]);
  const date = normalizeDedupDate(fields && fields["日期"]);
  const amount = normalizeDedupAmount(fields && fields["增加销售额"]);
  if (!title || !date || !amount) return "";
  return `${title}|${date}|${amount}`;
}

function extractComparableText(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (first && typeof first.text === "string") {
      return first.text.trim();
    }
    if (typeof first === "string" || typeof first === "number") {
      return String(first).trim();
    }
  }
  return "";
}

async function buildLinkFieldResolvers(config, tokenRecord, tableFields) {
  const linkFields = tableFields.filter((field) => field && field.type === 18);
  const resolvers = new Map();

  for (const linkField of linkFields) {
    const fieldName = String(linkField.field_name || "").trim();
    const linkTableId = String(
      (linkField.property && linkField.property.table_id) || ""
    ).trim();
    if (!fieldName || !linkTableId) continue;

    const linkTableFields = await listBitableFields(
      config,
      tokenRecord.accessToken,
      linkTableId
    );
    const primaryField =
      linkTableFields.find((field) => field && field.is_primary) ||
      linkTableFields.find((field) => field && field.type === 1) ||
      linkTableFields[0];
    const lookupFieldName = String(
      (primaryField && primaryField.field_name) || ""
    ).trim();
    if (!lookupFieldName) continue;

    const linkTableRecords = await listAllBitableRecords(
      config,
      tokenRecord.accessToken,
      linkTableId,
      [lookupFieldName]
    );

    const nameToRecordIds = new Map();
    for (const item of linkTableRecords) {
      const rid = String((item && item.record_id) || "").trim();
      if (!rid) continue;
      const text = extractComparableText(
        item && item.fields && item.fields[lookupFieldName]
      );
      const key = normalizeLookupKey(text);
      if (!key) continue;
      const ids = nameToRecordIds.get(key) || [];
      ids.push(rid);
      nameToRecordIds.set(key, ids);
    }

    resolvers.set(fieldName, {
      fieldName,
      linkTableId,
      linkTableName: String(
        (linkField.property && linkField.property.table_name) || ""
      ).trim(),
      lookupFieldName,
      nameToRecordIds
    });
  }

  return resolvers;
}

async function prepareBitableRowsFromXlsx(
  { filePath, sheet, limit, fieldAliases },
  config,
  tokenRecord
) {
  const sheetNameArg = String(sheet || "").trim();
  const { sheetName, headers, records } = parseXlsxRows(
    filePath,
    sheetNameArg
  );
  const limitN = toPositiveInteger(limit, 0);
  const selectedRecords = limitN > 0 ? records.slice(0, limitN) : records;

  const tableFields = await listBitableFields(config, tokenRecord.accessToken);
  const writableFields = tableFields.filter(
    (item) => !NON_WRITABLE_FIELD_TYPES.has(item.type)
  );
  const writableFieldMap = new Map(
    writableFields
      .map((item) => [String(item.field_name || "").trim(), item])
      .filter((item) => item[0])
  );
  const linkFieldResolvers = await buildLinkFieldResolvers(
    config,
    tokenRecord,
    writableFields
  );

  const unknownHeaders = [];
  const aliasHeaders = [];
  for (const sourceHeader of headers) {
    const targetField = fieldAliases[sourceHeader] || sourceHeader;
    if (targetField !== sourceHeader) {
      aliasHeaders.push(`${sourceHeader} -> ${targetField}`);
    }
    if (!writableFieldMap.has(targetField)) {
      unknownHeaders.push(sourceHeader);
    }
  }

  const droppedValueStats = {};
  const unresolvedLinkValueStats = {};
  const ambiguousLinkValueStats = {};
  const normalizedRecords = selectedRecords
    .map((record) => {
      const normalizedFields = {};
      for (const [sourceField, rawValue] of Object.entries(record.fields)) {
        const targetField = fieldAliases[sourceField] || sourceField;
        const fieldMeta = writableFieldMap.get(targetField);
        if (!fieldMeta) continue;
        if (fieldMeta.type === 18) {
          const resolver = linkFieldResolvers.get(targetField);
          if (!resolver) continue;
          const lookupText = extractComparableText(rawValue);
          const lookupKey = normalizeLookupKey(lookupText);
          if (!lookupKey) continue;
          const matchedIds = resolver.nameToRecordIds.get(lookupKey) || [];
          if (!matchedIds.length) {
            const missKey = `${targetField}:${lookupText}`;
            unresolvedLinkValueStats[missKey] =
              (unresolvedLinkValueStats[missKey] || 0) + 1;
            continue;
          }
          if (matchedIds.length > 1) {
            const ambKey = `${targetField}:${lookupText}`;
            ambiguousLinkValueStats[ambKey] =
              (ambiguousLinkValueStats[ambKey] || 0) + 1;
            continue;
          }
          normalizedFields[targetField] = [matchedIds[0]];
          continue;
        }
        const normalizedValue = sanitizeFieldValue(
          rawValue,
          fieldMeta,
          droppedValueStats,
          targetField
        );
        if (normalizedValue === undefined) continue;
        normalizedFields[targetField] = normalizedValue;
      }
      return {
        rowNumber: record.rowNumber,
        fields: normalizedFields
      };
    })
    .filter((record) => Object.keys(record.fields).length > 0);

  return {
    sheetName,
    headers,
    totalXlsxRows: records.length,
    selectedRowCount: selectedRecords.length,
    normalizedRecords,
    unknownHeaders,
    aliasHeaders,
    droppedValueStats,
    unresolvedLinkValueStats,
    ambiguousLinkValueStats,
    writableFieldMap
  };
}

function sanitizeFieldValue(value, fieldMeta, droppedValueStats, fieldName) {
  if (isEmptyCellValue(value)) return undefined;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    if (text === "-" || text === "--" || text === "—") return undefined;
    value = text;
  }

  if (!fieldMeta) return value;

  if (fieldMeta.type === 2) {
    const num = toNumberOrNull(value);
    if (num === null) {
      droppedValueStats[fieldName] = (droppedValueStats[fieldName] || 0) + 1;
      return undefined;
    }
    return num;
  }

  if (fieldMeta.type === 5) {
    const ts = toDateTimestampOrNull(value);
    if (ts === null) {
      droppedValueStats[fieldName] = (droppedValueStats[fieldName] || 0) + 1;
      return undefined;
    }
    return ts;
  }

  return value;
}

function parseBackupProfilesArg(args) {
  const raw = readOption(args, "profiles");
  if (raw === undefined || raw === true) {
    return ["creator", "shop"];
  }
  const text = String(raw).trim();
  if (!text) {
    return ["creator", "shop"];
  }
  return text
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function bitableFieldValueToCellForBackup(value, fieldMeta) {
  if (value === undefined || value === null) return "";
  const type = fieldMeta && fieldMeta.type;

  if (type === 2) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const n = Number(
      typeof value === "string" ? String(value).replace(/,/g, "") : value
    );
    return Number.isFinite(n) ? n : String(value);
  }

  if (type === 5) {
    if (typeof value === "number" && Number.isFinite(value) && value > 1e11) {
      return new Date(value);
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value.replace(/\//g, "-").replace(" ", "T"));
      if (Number.isFinite(parsed)) return new Date(parsed);
    }
    return String(value);
  }

  if (type === 7) {
    if (typeof value === "boolean") return value ? "是" : "否";
    return String(value);
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  if (Array.isArray(value)) {
    if (
      value.length > 0 &&
      value.every((item) => typeof item === "string" || typeof item === "number")
    ) {
      return value.map((item) => String(item)).join(", ");
    }
    if (
      value.length > 0 &&
      value.every(
        (item) => item && typeof item === "object" && item.file_token != null
      )
    ) {
      return value
        .map((item) => String(item.name || item.file_token || "").trim())
        .filter(Boolean)
        .join(", ");
    }
    const parts = [];
    for (const item of value) {
      if (item == null) continue;
      if (typeof item === "string" || typeof item === "number") {
        parts.push(String(item));
        continue;
      }
      if (typeof item === "object") {
        if (item.text != null) {
          parts.push(String(item.text));
          continue;
        }
        if (item.name != null) {
          parts.push(String(item.name));
          continue;
        }
      }
    }
    if (parts.length) return parts.join("; ");
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (typeof value === "object") {
    if (value.text != null) return String(value.text);
    if (value.link != null) return String(value.link);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

async function backupBitableProfileToXlsx({
  profile,
  outDir,
  tokenRecord,
  dryRun
}) {
  const config = loadFeishuBitableConfigForProfile(profile);
  const label = DEFAULT_XLSX_NAME_PREFIX_BY_PROFILE[profile] || profile;
  const fileName = `${label}-飞书表备份.xlsx`;
  const outPath = path.join(outDir, fileName);

  const fieldMetas = (
    await listBitableFields(config, tokenRecord.accessToken)
  ).filter((item) => item && String(item.field_name || "").trim());
  const records = await listAllBitableRecords(
    config,
    tokenRecord.accessToken
  );

  const headers = [
    "record_id",
    ...fieldMetas.map((f) => String(f.field_name).trim())
  ];
  const rows = [headers];
  for (const rec of records) {
    const rid = String((rec && rec.record_id) || "");
    const flds = (rec && rec.fields) || {};
    const row = [rid];
    for (const fm of fieldMetas) {
      const name = String(fm.field_name).trim();
      row.push(bitableFieldValueToCellForBackup(flds[name], fm));
    }
    rows.push(row);
  }

  if (dryRun) {
    console.log(`[dry-run] ${profile}（${label}）-> ${outPath}（${records.length} 行）`);
    return outPath;
  }

  await fs.mkdir(outDir, { recursive: true });
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "备份");
  XLSX.writeFile(workbook, outPath);
  console.log(`已备份 ${label}（${records.length} 行）: ${outPath}`);
  return outPath;
}

function printLinkMappingWarnings(
  unresolvedLinkValueStats,
  ambiguousLinkValueStats
) {
  const unresolvedEntries = Object.entries(unresolvedLinkValueStats || {});
  if (unresolvedEntries.length) {
    console.warn(
      "以下关联字段值未在关联表中找到，已跳过:",
      unresolvedEntries
        .slice(0, 10)
        .map(([name, count]) => `${name}(${count})`)
        .join(", ")
    );
    if (unresolvedEntries.length > 10) {
      console.warn(`- 其余未匹配项省略 ${unresolvedEntries.length - 10} 条`);
    }
  }

  const ambiguousEntries = Object.entries(ambiguousLinkValueStats || {});
  if (ambiguousEntries.length) {
    console.warn(
      "以下关联字段值在关联表中匹配到多条记录，已跳过:",
      ambiguousEntries
        .slice(0, 10)
        .map(([name, count]) => `${name}(${count})`)
        .join(", ")
    );
    if (ambiguousEntries.length > 10) {
      console.warn(`- 其余重复匹配项省略 ${ambiguousEntries.length - 10} 条`);
    }
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    printHelp();
    return;
  }

  const config = loadFeishuConfig();

  if (command === "auth-url") {
    ensureConfigValue(config, "redirectUri", "FEISHU_OAUTH_REDIRECT_URI");
    const state = String(readOption(args, "state") || "");
    const url = buildAuthorizeUrl(config, state);
    console.log(url);
    if (shouldAutoOpenAuthUrl(args)) {
      try {
        await openUrlInDefaultBrowser(url);
        console.log("已尝试使用默认浏览器打开授权地址。");
      } catch (openError) {
        console.warn(
          "自动打开浏览器失败，请手动复制链接打开。",
          openError.message || ""
        );
      }
    }
    return;
  }

  if (command === "exchange") {
    ensureConfigValue(config, "redirectUri", "FEISHU_OAUTH_REDIRECT_URI");
    const code = readOption(args, "code");
    if (!code || typeof code !== "string") {
      throw new Error("exchange 需要提供 --code <authorization_code>");
    }
    const tokenRecord = await exchangeCodeForToken(config, code.trim());
    await writeTokenCache(config.tokenCachePath, tokenRecord);
    console.log("授权成功，token 已写入:", config.tokenCachePath);
    console.log(
      "access_token 到期时间:",
      new Date(tokenRecord.expiresAt).toISOString()
    );
    return;
  }

  if (command === "refresh") {
    const cached = await readTokenCache(config.tokenCachePath);
    if (!cached || !cached.refreshToken) {
      throw new Error("本地没有 refresh_token，请先执行 exchange");
    }
    const tokenRecord = await refreshAccessToken(config, cached.refreshToken);
    await writeTokenCache(config.tokenCachePath, tokenRecord);
    console.log("刷新成功，token 已更新:", config.tokenCachePath);
    console.log(
      "access_token 到期时间:",
      new Date(tokenRecord.expiresAt).toISOString()
    );
    return;
  }

  if (command === "insert") {
    const fields = await readFieldsFromArgs(args);
    const tokenRecord = await getValidAccessToken(config);
    const data = await createBitableRecord(
      config,
      tokenRecord.accessToken,
      fields
    );
    const recordId = data && data.record && data.record.record_id;
    console.log("插入成功");
    if (recordId) {
      console.log("record_id:", recordId);
    }
    return;
  }

  if (command === "insert-xlsx") {
    const fileOption = readOption(args, "file");
    if (!fileOption || typeof fileOption !== "string") {
      throw new Error("insert-xlsx 需要提供 --file <xlsx路径>");
    }

    const filePath = path.resolve(process.cwd(), fileOption.trim());
    const sheet = String(readOption(args, "sheet") || "").trim();
    const dryRun = Boolean(readOption(args, "dry-run", "dryRun"));
    const limit = toPositiveInteger(readOption(args, "limit"), 0);
    const fieldAliases = readXlsxFieldAliases(args);

    const tokenRecord = await getValidAccessToken(config);
    const prepared = await prepareBitableRowsFromXlsx(
      { filePath, sheet, limit, fieldAliases },
      config,
      tokenRecord
    );
    const {
      sheetName,
      totalXlsxRows,
      selectedRowCount,
      normalizedRecords,
      unknownHeaders,
      aliasHeaders,
      droppedValueStats,
      unresolvedLinkValueStats,
      ambiguousLinkValueStats
    } = prepared;

    console.log(`xlsx 文件: ${filePath}`);
    console.log(`sheet: ${sheetName}`);
    console.log(`读取到 ${totalXlsxRows} 行有效数据`);
    if (limit > 0) {
      console.log(`按 --limit 限制后，本次将处理 ${selectedRowCount} 行`);
    }

    if (selectedRowCount <= 0) {
      console.log("没有可写入的数据，已跳过。");
      return;
    }
    if (aliasHeaders.length) {
      console.log("自动字段映射:", aliasHeaders.join(", "));
    }
    if (unknownHeaders.length) {
      console.warn(
        `以下 xlsx 列在飞书表中不存在或不可写，已自动忽略: ${unknownHeaders.join(", ")}`
      );
    }
    printLinkMappingWarnings(unresolvedLinkValueStats, ambiguousLinkValueStats);

    if (!normalizedRecords.length) {
      console.log("标准化后没有可写入字段，已跳过。");
      return;
    }

    if (dryRun) {
      console.log("dry-run 模式，不执行写入。预览前 3 行:");
      normalizedRecords.slice(0, 3).forEach((record) => {
        console.log(`- 行 ${record.rowNumber}:`, JSON.stringify(record.fields));
      });
      const droppedEntries = Object.entries(droppedValueStats);
      if (droppedEntries.length) {
        console.log(
          "已跳过无法转换的单元格:",
          droppedEntries.map(([name, count]) => `${name}(${count})`).join(", ")
        );
      }
      return;
    }

    let successCount = 0;
    const failedRows = [];

    for (const record of normalizedRecords) {
      try {
        await createBitableRecord(
          config,
          tokenRecord.accessToken,
          record.fields
        );
        successCount += 1;
      } catch (error) {
        failedRows.push({
          rowNumber: record.rowNumber,
          message: error.message || String(error)
        });
      }
    }

    console.log(
      `写入完成: 成功 ${successCount} 行，失败 ${failedRows.length} 行`
    );
    const droppedEntries = Object.entries(droppedValueStats);
    if (droppedEntries.length) {
      console.log(
        "写入前已跳过无法转换的单元格:",
        droppedEntries.map(([name, count]) => `${name}(${count})`).join(", ")
      );
    }
    if (failedRows.length) {
      failedRows.slice(0, 5).forEach((item) => {
        console.error(`- 失败行 ${item.rowNumber}: ${item.message}`);
      });
      if (failedRows.length > 5) {
        console.error(`- 其余失败行省略 ${failedRows.length - 5} 条`);
      }
      throw new Error("部分行写入失败，请根据日志修正后重试");
    }
    return;
  }

  if (command === "sync-data-xlsx") {
    const fileOption = readOption(args, "file");
    const dirOption = readOption(args, "dir") || getDefaultExportsDir();
    const sheet = String(readOption(args, "sheet") || "").trim();
    const dryRun = Boolean(readOption(args, "dry-run", "dryRun"));
    const limit = toPositiveInteger(readOption(args, "limit"), 0);
    const keepRowsArg = readOption(args, "keep-rows", "keepRows");
    const defaultKeepRows = readProfileKeepRowsFromProjectConfig(
      optionalEnv("FEISHU_BITABLE_PROFILE", "shop")
    );
    const keepLeadingRows =
      keepRowsArg !== undefined
        ? toNonNegativeInteger(keepRowsArg, 0)
        : toNonNegativeInteger(defaultKeepRows, 0);
    const fieldAliases = readXlsxFieldAliases(args);

    const defaultNamePrefix = defaultXlsxNamePrefixForSync();
    const filePath = fileOption
      ? path.resolve(process.cwd(), String(fileOption).trim())
      : await findLatestXlsxFile(dirOption, defaultNamePrefix);

    const tokenRecord = await getValidAccessToken(config);

    // 同步前先备份飞书表当前数据（dry-run 跳过）
    if (!dryRun) {
      const syncProfile = optionalEnv("FEISHU_BITABLE_PROFILE", "shop");
      const backupOutDir = path.resolve(process.cwd(), getDefaultExportsDir());
      await backupBitableProfileToXlsx({
        profile: syncProfile,
        outDir: backupOutDir,
        tokenRecord,
        dryRun: false,
      });
    }

    const prepared = await prepareBitableRowsFromXlsx(      { filePath, sheet, limit, fieldAliases },
      config,
      tokenRecord
    );
    const {
      sheetName,
      totalXlsxRows,
      normalizedRecords,
      unknownHeaders,
      aliasHeaders,
      droppedValueStats,
      unresolvedLinkValueStats,
      ambiguousLinkValueStats
    } = prepared;

    if (!fileOption && defaultNamePrefix) {
      console.log(
        `未指定 --file：已按 FEISHU_BITABLE_PROFILE 选用文件名以「${defaultNamePrefix}」开头且修改时间最新的 .xlsx`
      );
    }
    console.log(`同步来源: ${filePath}`);
    console.log(`sheet: ${sheetName}`);
    console.log(
      `xlsx 有效行: ${totalXlsxRows}，本次准备写入: ${normalizedRecords.length} 行`
    );

    if (aliasHeaders.length) {
      console.log("自动字段映射:", aliasHeaders.join(", "));
    }
    if (unknownHeaders.length) {
      console.warn(
        `以下 xlsx 列在飞书表中不存在或不可写，已自动忽略: ${unknownHeaders.join(", ")}`
      );
    }
    printLinkMappingWarnings(unresolvedLinkValueStats, ambiguousLinkValueStats);

    if (!normalizedRecords.length) {
      console.log("标准化后没有可写入字段，已跳过（未清空表格）。");
      return;
    }

    if (dryRun) {
      const dryMsg =
        keepLeadingRows > 0
          ? `dry-run：将保留飞书表前 ${keepLeadingRows} 条（按接口列出顺序），删除其余记录后批量写入；预览前 3 行:`
          : "dry-run：将清空飞书表全部记录后批量写入；预览前 3 行:";
      console.log(dryMsg);
      normalizedRecords.slice(0, 3).forEach((record) => {
        console.log(`- 行 ${record.rowNumber}:`, JSON.stringify(record.fields));
      });
      const droppedEntries = Object.entries(droppedValueStats);
      if (droppedEntries.length) {
        console.log(
          "已跳过无法转换的单元格:",
          droppedEntries.map(([name, count]) => `${name}(${count})`).join(", ")
        );
      }
      return;
    }

    const existingIds = await listAllBitableRecordIds(
      config,
      tokenRecord.accessToken
    );
    const idsToDelete =
      keepLeadingRows > 0 ? existingIds.slice(keepLeadingRows) : existingIds;

    if (keepLeadingRows > 0) {
      const kept = Math.min(keepLeadingRows, existingIds.length);
      console.log(
        `飞书表现有记录: ${existingIds.length} 条；保留前 ${kept} 条（按接口列出顺序），将删除其余 ${idsToDelete.length} 条…`
      );
    } else {
      console.log(`飞书表现有记录: ${existingIds.length} 条，开始清空…`);
    }

    const deleteChunks = chunkArray(idsToDelete, 500);
    for (let i = 0; i < deleteChunks.length; i += 1) {
      await batchDeleteBitableRecords(
        config,
        tokenRecord.accessToken,
        deleteChunks[i]
      );
      if (i < deleteChunks.length - 1) {
        await sleepMs(200);
      }
    }

    const BATCH = 500;
    const createChunks = chunkArray(
      normalizedRecords.map((record) => ({ fields: record.fields })),
      BATCH
    );
    let created = 0;
    for (let i = 0; i < createChunks.length; i += 1) {
      await batchCreateBitableRecords(
        config,
        tokenRecord.accessToken,
        createChunks[i]
      );
      created += createChunks[i].length;
      if (i < createChunks.length - 1) {
        await sleepMs(200);
      }
    }

    const deletedCount = idsToDelete.length;
    console.log(
      `覆盖写入完成: 已删除 ${deletedCount} 条，已新增 ${created} 条` +
        (keepLeadingRows > 0
          ? `（另有 ${Math.min(keepLeadingRows, existingIds.length)} 条已保留）`
          : "")
    );
    const droppedEntries = Object.entries(droppedValueStats);
    if (droppedEntries.length) {
      console.log(
        "写入前已跳过无法转换的单元格:",
        droppedEntries.map(([name, count]) => `${name}(${count})`).join(", ")
      );
    }
    return;
  }

  if (command === "sync-data-xlsx-shop") {
    const fileOption = readOption(args, "file");
    const sheet = String(readOption(args, "sheet") || "").trim();
    const dryRun = Boolean(readOption(args, "dry-run", "dryRun"));
    const limit = toPositiveInteger(readOption(args, "limit"), 0);
    const replaceMode = Boolean(readOption(args, "replace"));
    const keepLeadingRows = replaceMode
      ? toNonNegativeInteger(readOption(args, "keep-rows", "keepRows"), 0)
      : 0;
    const fieldAliases = readShopXlsxFieldAliases(args);

    const filePath = fileOption
      ? path.resolve(process.cwd(), String(fileOption).trim())
      : path.resolve(process.cwd(), SHOP_DEFAULT_XLSX_RELATIVE);

    const tokenRecord = await getValidAccessToken(config);

    if (!dryRun) {
      const shopBackupOutDir = path.resolve(process.cwd(), getDefaultExportsDir());
      await backupBitableProfileToXlsx({
        profile: "shop",
        outDir: shopBackupOutDir,
        tokenRecord,
        dryRun: false,
      });
    }

    const prepared = await prepareBitableRowsFromXlsx(
      { filePath, sheet, limit, fieldAliases },
      config,
      tokenRecord
    );
    const {
      sheetName,
      totalXlsxRows,
      normalizedRecords,
      unknownHeaders,
      aliasHeaders,
      droppedValueStats,
      unresolvedLinkValueStats,
      ambiguousLinkValueStats,
      writableFieldMap
    } = prepared;

    console.log(`同步来源（抖店 shop）: ${filePath}`);
    console.log(`sheet: ${sheetName}`);
    console.log(`xlsx 有效行: ${totalXlsxRows} 条` +
      (replaceMode ? "（--replace 覆盖模式）" : "（追加+补全模式）"));

    if (aliasHeaders.length) {
      console.log("自动字段映射:", aliasHeaders.join(", "));
    }
    if (unknownHeaders.length) {
      console.warn(
        `以下 xlsx 列在飞书表中不存在或不可写，已自动忽略: ${unknownHeaders.join(", ")}`
      );
    }
    printLinkMappingWarnings(unresolvedLinkValueStats, ambiguousLinkValueStats);

    if (!normalizedRecords.length) {
      console.log("标准化后没有可写入字段，已跳过（未写入表格）。");
      return;
    }

    // === 去重 + 补全：按 作品名+日期+增加销售额 三字段匹配 ===
    //   匹配成功 → 检查该行其他列是否为空，为空则用 xlsx 值补全
    //   未匹配   → 作为新行追加
    let recordsToCreate = [];
    let recordsToUpdate = [];
    let dedupSkipped = 0;
    if (!replaceMode && normalizedRecords.length > 0) {
      const existing = await listAllBitableRecords(
        config,
        tokenRecord.accessToken
      );

      const existingMap = new Map();
      for (const rec of existing) {
        const key = makeShopDedupKey((rec && rec.fields) || {});
        if (key) {
          if (!existingMap.has(key)) {
            existingMap.set(key, { id: String(rec.record_id || ""), fields: rec.fields || {} });
          }
        }
      }

      if (existingMap.size > 0) {
        const allFieldNames = new Set();
        for (const [ , meta ] of writableFieldMap) {
          allFieldNames.add(String(meta.field_name || "").trim());
        }

        const seenXlsxKeys = new Set();
        for (const record of normalizedRecords) {
          const key = makeShopDedupKey(record.fields || {});
          if (!key) {
            recordsToCreate.push(record);
            continue;
          }
          if (seenXlsxKeys.has(key)) continue;
          seenXlsxKeys.add(key);

          if (!existingMap.has(key)) {
            recordsToCreate.push(record);
            continue;
          }

          const existing = existingMap.get(key);
          const updatePayload = {};
          let hasEmpty = false;

          for (const fieldName of allFieldNames) {
            if (!fieldName) continue;
            const xlsxValue = record.fields[fieldName];
            if (isEmptyCellValue(xlsxValue)) continue;
            const existingValue = existing.fields[fieldName];
            if (isEmptyCellValue(existingValue)) {
              updatePayload[fieldName] = xlsxValue;
              hasEmpty = true;
            } else if (Array.isArray(existingValue) && existingValue.length === 0) {
              updatePayload[fieldName] = xlsxValue;
              hasEmpty = true;
            }
          }

          if (hasEmpty && Object.keys(updatePayload).length > 0) {
            recordsToUpdate.push({
              rowNumber: record.rowNumber,
              fields: updatePayload,
              record_id: existing.id,
            });
          }

          dedupSkipped++;
        }
      } else {
        recordsToCreate = normalizedRecords;
      }
    }

    if (replaceMode) {
      recordsToCreate = normalizedRecords;
    }

    if (dryRun) {
      if (replaceMode) {
        console.log(
          `dry-run（replace）：将${keepLeadingRows > 0 ? `保留前 ${keepLeadingRows} 条，` : ""}删除其余后写入 ${recordsToCreate.length} 条`
        );
      } else {
        const parts = [];
        if (recordsToCreate.length) parts.push(`新增 ${recordsToCreate.length} 条`);
        if (recordsToUpdate.length) parts.push(`补全 ${recordsToUpdate.length} 条`);
        const complete = dedupSkipped - recordsToUpdate.length;
        if (complete > 0) parts.push(`${complete} 条已完整`);
        console.log(`dry-run（追加+补全）: ${parts.join("，")}`);
      }
      recordsToCreate.slice(0, 3).forEach((record) => {
        console.log(`  [预览] 行 ${record.rowNumber}:`, JSON.stringify(record.fields));
      });
      const droppedEntries = Object.entries(droppedValueStats);
      if (droppedEntries.length) {
        console.log(
          "已跳过无法转换的单元格:",
          droppedEntries.map(([name, count]) => `${name}(${count})`).join(", ")
        );
      }
      return;
    }

    let deletedCount = 0;
    let replaceExistingTotal = 0;
    if (replaceMode) {
      const existingIds = await listAllBitableRecordIds(
        config,
        tokenRecord.accessToken
      );
      replaceExistingTotal = existingIds.length;
      const idsToDelete =
        keepLeadingRows > 0 ? existingIds.slice(keepLeadingRows) : existingIds;

      if (keepLeadingRows > 0) {
        const kept = Math.min(keepLeadingRows, existingIds.length);
        console.log(
          `飞书表现有记录: ${existingIds.length} 条；保留前 ${kept} 条（按接口列出顺序），将删除其余 ${idsToDelete.length} 条…`
        );
      } else {
        console.log(`飞书表现有记录: ${existingIds.length} 条，开始清空…`);
      }

      const deleteChunks = chunkArray(idsToDelete, 500);
      for (let i = 0; i < deleteChunks.length; i += 1) {
        await batchDeleteBitableRecords(
          config,
          tokenRecord.accessToken,
          deleteChunks[i]
        );
        if (i < deleteChunks.length - 1) {
          await sleepMs(200);
        }
      }
      deletedCount = idsToDelete.length;
    } else {
      const summaryParts = [];
      const newCount = recordsToCreate.length;
      const updateCount = recordsToUpdate.length;
      const completeCount = dedupSkipped - updateCount;
      if (newCount) summaryParts.push(`${newCount} 条新增`);
      if (updateCount) summaryParts.push(`${updateCount} 条补全`);
      if (completeCount) summaryParts.push(`${completeCount} 条已完整（匹配但无需补全）`);
      if (!summaryParts.length) summaryParts.push("无新增、无补全、无完整匹配");
      console.log(`匹配结果: ${summaryParts.join("，")}`);
    }

    // === 先执行补全更新 ===
    let updated = 0;
    if (recordsToUpdate.length > 0) {
      const BATCH = 500;
      const updateChunks = chunkArray(
        recordsToUpdate.map((r) => ({
          record_id: r.record_id,
          fields: r.fields,
        })),
        BATCH
      );
      for (let i = 0; i < updateChunks.length; i += 1) {
        await batchUpdateBitableRecords(
          config,
          tokenRecord.accessToken,
          updateChunks[i]
        );
        updated += updateChunks[i].length;
        if (i < updateChunks.length - 1) {
          await sleepMs(200);
        }
      }
    }

    // === 再执行新增 ===
    if (!recordsToCreate.length && !replaceMode) {
      if (updated > 0) {
        console.log(`补全完成: 已更新 ${updated} 条。`);
      } else {
        console.log("无需写入。");
      }
      return;
    }

    const BATCH = 500;
    const createChunks = chunkArray(
      recordsToCreate.map((record) => ({ fields: record.fields })),
      BATCH
    );
    let created = 0;
    for (let i = 0; i < createChunks.length; i += 1) {
      await batchCreateBitableRecords(
        config,
        tokenRecord.accessToken,
        createChunks[i]
      );
      created += createChunks[i].length;
      if (i < createChunks.length - 1) {
        await sleepMs(200);
      }
    }

    if (replaceMode) {
      console.log(
        `覆盖写入完成: 已删除 ${deletedCount} 条，已新增 ${created} 条` +
          (keepLeadingRows > 0
            ? `（另有 ${Math.min(keepLeadingRows, replaceExistingTotal)} 条已保留）`
            : "")
      );
    } else {
      const parts = [];
      if (created > 0) parts.push(`新增 ${created} 条`);
      if (updated > 0) parts.push(`补全 ${updated} 条`);
      console.log(`写入完成: ${parts.join("，")}`);
    }

    const droppedEntries = Object.entries(droppedValueStats);
    if (droppedEntries.length) {
      console.log(
        "写入前已跳过无法转换的单元格:",
        droppedEntries.map(([name, count]) => `${name}(${count})`).join(", ")
      );
    }
    return;
  }

  if (command === "backup-bitable") {
    const dirOption = readOption(args, "dir") || getDefaultExportsDir();
    const outDir = path.resolve(process.cwd(), String(dirOption).trim());
    const dryRun = Boolean(readOption(args, "dry-run", "dryRun"));
    const profiles = parseBackupProfilesArg(args);
    const tokenRecord = await getValidAccessToken(loadFeishuConfig());

    console.log(
      `飞书表备份: profiles=[${profiles.join(", ")}]，输出目录: ${outDir}` +
        (dryRun ? "（dry-run）" : "")
    );
    for (const profile of profiles) {
      await backupBitableProfileToXlsx({
        profile,
        outDir,
        tokenRecord,
        dryRun
      });
    }
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

run().catch((error) => {
  console.error("执行失败:", error.message || error);
  process.exitCode = 1;
});
