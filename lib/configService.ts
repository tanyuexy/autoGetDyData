import type { ConfigData } from "@/types";
import { getDb } from "./db/mongo";

function normalizeConfig(data: Partial<ConfigData> | null | undefined): ConfigData {
  return {
    accounts: data?.accounts || [],
    emails: data?.emails || [],
    creatorExportDateStart: (data as any)?.creatorExportDateStart || null,
    creatorExportDateStartByAccount:
      data?.creatorExportDateStartByAccount || {},
    douyinCreator: data?.douyinCreator || { loginVerifyMethod: "qr" },
    headless: data?.headless ?? false,
    creatorPublish: {
      publishEnabled: data?.creatorPublish?.publishEnabled ?? true,
      publishWaitSec: data?.creatorPublish?.publishWaitSec ?? 3,
    },
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

export async function getConfig(): Promise<ConfigData> {
  const db = await getDb();
  const data = await db.collection<any>("app_config").findOne({ _id: "default" });
  return normalizeConfig(data as Partial<ConfigData> | null);
}

export async function saveConfig(data: ConfigData): Promise<void> {
  const db = await getDb();
  const existing = await db.collection<any>("app_config").findOne({ _id: "default" });
  const merged = { ...(existing || {}), ...data, _id: "default", updatedAt: new Date() };
  await db.collection<any>("app_config").replaceOne({ _id: "default" }, merged, { upsert: true });
}
