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
      automation: {
        enabled: data?.creatorPublish?.automation?.enabled ?? false,
        mode: data?.creatorPublish?.automation?.mode ?? "weekly",
        weekly: {
          days: data?.creatorPublish?.automation?.weekly?.days ?? [1, 2, 3, 4, 5],
          times: data?.creatorPublish?.automation?.weekly?.times ?? ["09:00"],
        },
        interval: {
          days: data?.creatorPublish?.automation?.interval?.days ?? [1, 2, 3, 4, 5],
          everyMinutes: data?.creatorPublish?.automation?.interval?.everyMinutes ?? 60,
          anchorAt: data?.creatorPublish?.automation?.interval?.anchorAt ?? null,
        },
      },
    },
    feishu: {
      shop: data?.feishu?.shop || { appToken: "", tableId: "" },
      creator: data?.feishu?.creator || { appToken: "", tableId: "", keepRows: 0 },
      task: data?.feishu?.task || {
        baseUrl: "https://a5bgloffd0.feishu.cn/base/T64RbXS6wak6QqsaSqzcx0F8n4f?table=tblVym8chEalMZgl&view=vew11jDYDk",
        appToken: "T64RbXS6wak6QqsaSqzcx0F8n4f",
        tableId: "tblVym8chEalMZgl",
      },
      product: data?.feishu?.product || {
        baseUrl:
          "https://a5bgloffd0.feishu.cn/base/T64RbXS6wak6QqsaSqzcx0F8n4f?table=tblx4oJCulsxEomk&view=vewn3FYuwC",
        appToken: "T64RbXS6wak6QqsaSqzcx0F8n4f",
        tableId: "tblx4oJCulsxEomk",
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
