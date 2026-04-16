#!/usr/bin/env node
require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const XLSX = require("xlsx");
const { loadFeishuConfig, optionalEnv } = require("./lib/config");
const {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  writeTokenCache,
  readTokenCache,
  getValidAccessToken
} = require("./lib/oauth");
const { createBitableRecord, listBitableFields } = require("./lib/bitable");

const DEFAULT_XLSX_FIELD_ALIASES = {
  作品名称: "作品名",
  "5s完播率": "5秒完播率",
  "2s跳出率": "2秒跳出率",
  平均播放时长: "平播时长",
  主页访问量: "主页访量",
  粉丝增量: "增粉"
};
const NON_WRITABLE_FIELD_TYPES = new Set([19, 20]);

function printHelp() {
  console.log(`
飞书多维表格 OAuth2 工具

用法:
  node scripts/feishu/index.js auth-url [--state xxx] [--no-open]
  npm run feishu:callback
  node scripts/feishu/index.js exchange --code <authorization_code>
  node scripts/feishu/index.js refresh
  node scripts/feishu/index.js insert --fields '{"姓名":"张三","金额":100}'
  node scripts/feishu/index.js insert --fields-file ./data/record.json
  node scripts/feishu/index.js insert-xlsx --file ./data/作品列表.xlsx [--sheet Sheet1] [--dry-run]

说明:
  - auth-url: 生成 OAuth 授权地址（默认自动拉起浏览器，可用 --no-open 关闭）
  - feishu:callback: 启动本地回调服务，自动 exchange 并保存 token
  - exchange: 用回调 code 换取 access_token/refresh_token 并写入本地缓存
  - refresh: 强制刷新 access_token
  - insert: 自动检查/刷新 token 后插入一条多维表格记录
  - insert-xlsx: 读取 xlsx 第一行作为字段名，按行写入飞书多维表格
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
    const raw = await fs.readFile(path.resolve(process.cwd(), fieldsFile), "utf8");
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
  throw new Error("请提供 --fields 或 --fields-file，或设置 FEISHU_INSERT_FIELDS_JSON");
}

function toPositiveInteger(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
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

  const targetSheetName = String(sheetName || "").trim() || workbook.SheetNames[0];
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

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
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
        console.warn("自动打开浏览器失败，请手动复制链接打开。", openError.message || "");
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
    console.log("access_token 到期时间:", new Date(tokenRecord.expiresAt).toISOString());
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
    console.log("access_token 到期时间:", new Date(tokenRecord.expiresAt).toISOString());
    return;
  }

  if (command === "insert") {
    const fields = await readFieldsFromArgs(args);
    const tokenRecord = await getValidAccessToken(config);
    const data = await createBitableRecord(config, tokenRecord.accessToken, fields);
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

    const { sheetName, headers, records } = parseXlsxRows(filePath, sheet);
    const selectedRecords = limit > 0 ? records.slice(0, limit) : records;
    const fieldAliases = readXlsxFieldAliases(args);

    console.log(`xlsx 文件: ${filePath}`);
    console.log(`sheet: ${sheetName}`);
    console.log(`读取到 ${records.length} 行有效数据`);
    if (limit > 0) {
      console.log(`按 --limit 限制后，本次将处理 ${selectedRecords.length} 行`);
    }

    if (!selectedRecords.length) {
      console.log("没有可写入的数据，已跳过。");
      return;
    }

    const tokenRecord = await getValidAccessToken(config);
    const tableFields = await listBitableFields(config, tokenRecord.accessToken);
    const writableFields = tableFields.filter((item) => !NON_WRITABLE_FIELD_TYPES.has(item.type));
    const writableFieldMap = new Map(
      writableFields.map((item) => [String(item.field_name || "").trim(), item]).filter((item) => item[0])
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
    if (aliasHeaders.length) {
      console.log("自动字段映射:", aliasHeaders.join(", "));
    }
    if (unknownHeaders.length) {
      console.warn(
        `以下 xlsx 列在飞书表中不存在或不可写，已自动忽略: ${unknownHeaders.join(", ")}`
      );
    }

    const droppedValueStats = {};
    const normalizedRecords = selectedRecords
      .map((record) => {
        const normalizedFields = {};
        for (const [sourceField, rawValue] of Object.entries(record.fields)) {
          const targetField = fieldAliases[sourceField] || sourceField;
          const fieldMeta = writableFieldMap.get(targetField);
          if (!fieldMeta) continue;
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
        await createBitableRecord(config, tokenRecord.accessToken, record.fields);
        successCount += 1;
      } catch (error) {
        failedRows.push({
          rowNumber: record.rowNumber,
          message: error.message || String(error)
        });
      }
    }

    console.log(`写入完成: 成功 ${successCount} 行，失败 ${failedRows.length} 行`);
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

  throw new Error(`未知命令: ${command}`);
}

run().catch((error) => {
  console.error("执行失败:", error.message || error);
  process.exitCode = 1;
});

