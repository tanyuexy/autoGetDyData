// @ts-nocheck
import dotenv from "dotenv";

dotenv.config();

type Options = {
  profile: string;
  row: number | null;
  searches: string[];
  fieldsOnly: boolean; // 只读字段不读记录
  allFields: boolean;
  unmask: boolean;
};

const DEFAULT_DEBUG_FIELDS = [
  "计划发布时间",
  "定时",
  "定时时间",
  "发布时间",
  "挂车产品名",
  "所属店铺",
  "正文",
  "标题（可为空）",
  "已创建任务",
  "审批",
  "发布状态",
  "备注",
  "视频/图文内容",
];

function parseArgs(argv: string[]): Options {
  const options: Options = {
    profile: "task",
    row: null,
    searches: [],
    fieldsOnly: false,
    allFields: false,
    unmask: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile") options.profile = String(argv[++i] || "task");
    else if (arg === "--row") {
      const n = Number(argv[++i]);
      options.row = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } else if (arg === "--search") {
      const term = String(argv[++i] || "").trim();
      if (term) options.searches.push(term);
    } else if (arg === "--fields-only") options.fieldsOnly = true;
    else if (arg === "--all-fields") options.allFields = true;
    else if (arg === "--unmask") options.unmask = true;
  }

  return options;
}

function maskValue(value: unknown, unmask: boolean): unknown {
  if (unmask) return value;
  if (Array.isArray(value)) return value.map((item) => maskValue(item, unmask));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = /token|url|link/i.test(key) && child ? "[masked]" : maskValue(child, unmask);
    }
    return out;
  }
  return value;
}

function textOf(value: unknown): string {
  if (value == null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).join(" ");
  return String(value);
}

function printRecord(label: string, index: number, record: any, options: Options) {
  const fields = record?.fields || {};
  console.log(`\n${label}`, JSON.stringify({ apiIndex: index, recordId: record?.record_id || "" }));

  const names = options.allFields ? Object.keys(fields) : DEFAULT_DEBUG_FIELDS;
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(fields, name)) continue;
    const value = fields[name];
    console.log(`${name} = ${JSON.stringify(maskValue(value, options.unmask))} typeof=${typeof value}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const { getConfig } = await import("../../../../lib/configService");
  const cfg = await getConfig();
  process.env.PROJECT_CONFIG_JSON = JSON.stringify(cfg);

  const { readBitable, TYPE_MAP } = await import("../../../../lib/feishu/core/readBitable");
  const data = await readBitable(options.profile);

  console.log(
    "CONFIG",
    JSON.stringify({
      profile: options.profile,
      tableId: data.config.bitableTableId,
      appTokenPrefix: `${String(data.config.bitableAppToken || "").slice(0, 6)}...`,
    })
  );

  console.log("FIELDS");
  for (const field of data.fields) {
    console.log(
      JSON.stringify({
        name: field.field_name,
        id: field.field_id,
        type: field.type,
        typeName: TYPE_MAP[field.type] || `type-${field.type}`,
      })
    );
  }

  if (options.fieldsOnly) return;

  console.log("TOTAL_RECORDS", data.records.length);

  if (options.searches.length > 0) {
    const matches: Array<{ index: number; record: any }> = [];
    for (let i = 0; i < data.records.length; i += 1) {
      const record = data.records[i];
      const haystack = textOf(record.fields);
      if (options.searches.some((term) => haystack.includes(term))) {
        matches.push({ index: i + 1, record });
      }
    }

    console.log("MATCH_COUNT", matches.length);
    for (const match of matches.slice(0, 30)) {
      printRecord("MATCH", match.index, match.record, options);
    }
  }

  if (options.row) {
    const record = data.records[options.row - 1];
    if (!record) {
      console.log(`\nROW ${options.row} not found`);
      return;
    }
    printRecord("ROW", options.row, record, options);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
  });
