import fs from "fs";
import path from "path";
import type { ConfigData } from "@/types";

const CONFIG_PATH = path.resolve(
  process.env.PROJECT_CONFIG_PATH ||
    process.env.ADD_ACCOUNTS_JSON ||
    path.join(process.cwd(), "config.json")
);

function readConfig(): ConfigData | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getConfig(): ConfigData {
  const data = readConfig();
  return {
    accounts: data?.accounts || [],
    emails: data?.emails || [],
    creatorExportDateStart: (data as any)?.creatorExportDateStart || null,
    creatorExportDateStartByAccount:
      data?.creatorExportDateStartByAccount || {},
    douyinCreator: data?.douyinCreator || { loginVerifyMethod: "qr" },
    headless: data?.headless ?? false,
    feishu: {
      shop: data?.feishu?.shop || { appToken: "", tableId: "" },
      creator: data?.feishu?.creator || { appToken: "", tableId: "", keepRows: 0 },
      task: data?.feishu?.task || {
        baseUrl: "https://a5bgloffd0.feishu.cn/base/T64RbXS6wak6QqsaSqzcx0F8n4f?table=tblVym8chEalMZgl&view=vew11jDYDk",
        appToken: "T64RbXS6wak6QqsaSqzcx0F8n4f",
        tableId: "tblVym8chEalMZgl",
      },
    },
  };
}

export function saveConfig(data: ConfigData): void {
  // Atomic write: write to temp file then rename
  const tmpPath = CONFIG_PATH + ".tmp";
  // Preserve any keys we don't manage
  const existing = readConfig();
  const merged = { ...(existing || {}), ...data };
  fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  fs.renameSync(tmpPath, CONFIG_PATH);
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
