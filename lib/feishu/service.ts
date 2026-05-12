import { getConfig } from "@/lib/configService";

type FeishuSyncProfile = "creator" | "shop";

async function prepareProjectConfigEnv(profile?: string) {
  require("dotenv").config();
  process.env.PROJECT_CONFIG_JSON = JSON.stringify(await getConfig());
  if (profile) process.env.FEISHU_BITABLE_PROFILE = profile;
}

export async function syncFeishuBitable(options: {
  profile: FeishuSyncProfile;
  keepRows?: number;
  file?: string;
  replace?: boolean;
  dryRun?: boolean;
}) {
  const profile = options.profile;
  await prepareProjectConfigEnv(profile);
  const { runWithArgs } = require("@/lib/feishu/legacy-cli");

  const args =
    profile === "shop"
      ? ["sync-data-xlsx-shop"]
      : ["sync-data-xlsx"];

  if (options.file) args.push("--file", options.file);
  if (options.dryRun) args.push("--dry-run");
  if (profile === "shop" && options.replace) args.push("--replace");
  if (
    options.keepRows !== undefined &&
    Number.isFinite(Number(options.keepRows)) &&
    Number(options.keepRows) > 0
  ) {
    args.push("--keep-rows", String(Math.floor(Number(options.keepRows))));
  }

  await runWithArgs(args);
}

export async function backupFeishuBitable(options: {
  profiles?: string;
  dryRun?: boolean;
}) {
  await prepareProjectConfigEnv();
  const { runWithArgs } = require("@/lib/feishu/legacy-cli");
  const args = ["backup-bitable", "--profiles", options.profiles || "creator,shop"];
  if (options.dryRun) args.push("--dry-run");
  await runWithArgs(args);
}

export async function importPublishTasksFromFeishu(options: {
  autoStart?: boolean;
  allowCreate?: boolean;
  logger?: (...args: unknown[]) => void;
} = {}) {
  await prepareProjectConfigEnv("task");
  const { syncPublishTasks } = require("@/lib/feishu/sync-publish-tasks");
  return await syncPublishTasks({
    autoStart: options.autoStart === true,
    allowCreate: options.allowCreate !== false,
    logger: options.logger || console.log,
    summaryPrefix: "[import-publish-tasks-api]",
  });
}

export async function writeFeishuTaskStatus(options: {
  recordId: string;
  statusText: string;
  approvalText?: string;
}) {
  await prepareProjectConfigEnv("task");
  const { loadFeishuBitableConfigForProfile } = require("@/lib/feishu/core/config");
  const { getValidAccessToken } = require("@/lib/feishu/core/oauth");
  const { updateBitableRecord } = require("@/lib/feishu/core/bitable");

  const recordId = String(options.recordId || "").trim();
  const statusText = String(options.statusText || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const approvalText = String(options.approvalText || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!recordId) throw new Error("missing recordId");
  if (!statusText) throw new Error("missing statusText");

  const cfg = loadFeishuBitableConfigForProfile("task");
  const tokenCache = await getValidAccessToken(cfg);
  const fields: Record<string, string> = { 已创建任务: statusText };
  if (approvalText) fields.审批 = approvalText;
  await updateBitableRecord(cfg, tokenCache.accessToken, recordId, fields);
}

export async function markFeishuTaskPublished(recordId: string) {
  await writeFeishuTaskStatus({ recordId, statusText: "是" });
}
