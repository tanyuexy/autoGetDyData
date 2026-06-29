import type { ConfigData } from "@/types";
import { getDb } from "./db/mongo";
import { normalizeFeishuAiProvider } from "@/lib/feishu/aiProvider";
import {
  normalizeFeishuAiContentMaxConcurrent,
  FEISHU_AI_CONTENT_MAX_CONCURRENT_DEFAULT,
} from "@/lib/feishu/aiContentConcurrency";
import { normalizePublishMaxConcurrent, PUBLISH_MAX_CONCURRENT_DEFAULT } from "@/lib/creator-publish/publishConcurrency";
import { parseFeishuBitableUrl } from "@/lib/feishu/parse-bitable-url";

type BitableSection = {
  baseUrl?: string;
  appToken: string;
  tableId: string;
  keepRows?: number;
};

/**
 * 用 baseUrl 解析 appToken / tableId；解析失败时回退到已存储的字段。
 * 这样 UI 只需填一个 Base URL，脚本侧仍能拿到 appToken / tableId。
 */
function normalizeBitableSection(section: BitableSection | null | undefined): BitableSection {
  const baseUrl = String(section?.baseUrl || "").trim();
  const parsed = parseFeishuBitableUrl(baseUrl);
  if (parsed) {
    return {
      ...section,
      baseUrl,
      appToken: parsed.appToken,
      tableId: parsed.tableId,
    };
  }
  return {
    ...section,
    baseUrl,
    appToken: String(section?.appToken || "").trim(),
    tableId: String(section?.tableId || "").trim(),
  };
}

function normalizeConfig(data: Partial<ConfigData> | null | undefined): ConfigData {
  const defaultCreatorBitable = {
    baseUrl:
      "https://a5bgloffd0.feishu.cn/base/SjmubvbmCazk27sqcTucsSAmnPb?table=tblYnPxQjhaI4sWc&view=vewJjxCUVz",
    appToken: "SjmubvbmCazk27sqcTucsSAmnPb",
    tableId: "tblYnPxQjhaI4sWc",
    keepRows: 0,
  };
  const creatorBitable =
    data?.feishu?.creator?.appToken && data?.feishu?.creator?.tableId
      ? data.feishu.creator
      : defaultCreatorBitable;

  return {
    accounts: data?.accounts || [],
    emails: data?.emails || [],
    creatorExportDateStart: (data as any)?.creatorExportDateStart || null,
    creatorExportDateStartByAccount:
      data?.creatorExportDateStartByAccount || {},
    headless: data?.headless ?? false,
    creatorPublish: {
      publishEnabled: data?.creatorPublish?.publishEnabled ?? true,
      publishWaitSec: data?.creatorPublish?.publishWaitSec ?? 3,
      publishMaxConcurrent: normalizePublishMaxConcurrent(
        data?.creatorPublish?.publishMaxConcurrent ?? PUBLISH_MAX_CONCURRENT_DEFAULT
      ),
      feishuAiProvider: normalizeFeishuAiProvider(data?.creatorPublish?.feishuAiProvider),
      feishuAiContentMaxConcurrent: normalizeFeishuAiContentMaxConcurrent(
        data?.creatorPublish?.feishuAiContentMaxConcurrent ??
          FEISHU_AI_CONTENT_MAX_CONCURRENT_DEFAULT
      ),
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
      shop: normalizeBitableSection(data?.feishu?.shop || { baseUrl: "", appToken: "", tableId: "" }),
      creator: normalizeBitableSection(creatorBitable),
      task: normalizeBitableSection(
        data?.feishu?.task || {
          baseUrl: "https://a5bgloffd0.feishu.cn/base/T64RbXS6wak6QqsaSqzcx0F8n4f?table=tblVym8chEalMZgl&view=vew11jDYDk",
          appToken: "T64RbXS6wak6QqsaSqzcx0F8n4f",
          tableId: "tblVym8chEalMZgl",
        }
      ),
      product: normalizeBitableSection(
        data?.feishu?.product || {
          baseUrl:
            "https://a5bgloffd0.feishu.cn/base/T64RbXS6wak6QqsaSqzcx0F8n4f?table=tblx4oJCulsxEomk&view=vewn3FYuwC",
          appToken: "T64RbXS6wak6QqsaSqzcx0F8n4f",
          tableId: "tblx4oJCulsxEomk",
        }
      ),
      shopInfo: normalizeBitableSection(
        data?.feishu?.shopInfo || {
          baseUrl:
            "https://a5bgloffd0.feishu.cn/base/T64RbXS6wak6QqsaSqzcx0F8n4f?table=tblFoYG5sTkMlP07&view=vewwECx01M",
          appToken: "T64RbXS6wak6QqsaSqzcx0F8n4f",
          tableId: "tblFoYG5sTkMlP07",
        }
      ),
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
