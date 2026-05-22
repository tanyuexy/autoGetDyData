import dotenv from "dotenv";
import { getConfig } from "@/lib/configService";
import { normalizeFeishuAiProvider } from "@/lib/feishuAiProvider";
import type { LlmProvider } from "@/lib/llm";
import { runWithArgs } from "@/lib/feishu/legacy-cli";
import {
  peekFeishuSyncCandidates,
  syncPublishTasks,
} from "@/lib/feishu/sync-publish-tasks";
import { generateTaskAiContentToFeishu } from "@/lib/feishu/generate-task-ai-content";
import { loadFeishuBitableConfigForProfile } from "@/lib/feishu/core/config";
import { getValidAccessToken } from "@/lib/feishu/core/oauth";
import {
  getBitableRecord,
  updateBitableRecord,
} from "@/lib/feishu/core/bitable";

type FeishuSyncProfile = "creator" | "shop";

async function prepareProjectConfigEnv(profile?: string) {
  dotenv.config();
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
  const args = ["backup-bitable", "--profiles", options.profiles || "creator,shop"];
  if (options.dryRun) args.push("--dry-run");
  await runWithArgs(args);
}

export async function peekFeishuPublishImportCandidates(options: {
  logger?: (...args: unknown[]) => void;
} = {}) {
  await prepareProjectConfigEnv("task");
  return await peekFeishuSyncCandidates({
    logger: options.logger || console.log,
    summaryPrefix: "[peek-feishu-import-api]",
  });
}

export async function importPublishTasksFromFeishu(options: {
  autoStart?: boolean;
  allowCreate?: boolean;
  logger?: (...args: unknown[]) => void;
} = {}) {
  await prepareProjectConfigEnv("task");
  return await syncPublishTasks({
    autoStart: options.autoStart === true,
    allowCreate: options.allowCreate !== false,
    logger: options.logger || console.log,
    summaryPrefix: "[import-publish-tasks-api]",
  });
}

/** 预检 →（有候选则）AI 生成正文 → 飞书导入；手动与定时调度共用 */
export async function runFeishuPublishImportPipeline(options: {
  autoStart?: boolean;
  allowCreate?: boolean;
  provider?: LlmProvider;
  logger?: (...args: unknown[]) => void;
  isCancelled?: () => boolean;
  summaryPrefix?: string;
} = {}) {
  const log = options.logger || console.log;
  const summaryPrefix = options.summaryPrefix || "[feishu-import-pipeline]";

  log(`${summaryPrefix} 预检：飞书任务表是否满足导入条件`);
  const peek = await peekFeishuPublishImportCandidates({ logger: log });
  log(
    `  预检结果：任务表 ${peek.totalRecords} 条，待导入预检 ${peek.syncCandidateCount} 条` +
      (peek.remoteCreatedSkipCount
        ? `（已排除飞书已创建任务=是 ${peek.remoteCreatedSkipCount} 条）`
        : "")
  );

  if (peek.syncCandidateCount <= 0) {
    log("  没有满足同步条件的飞书任务，跳过 AI 生成与导入");
    return { skipped: true, reason: "no-sync-candidates" as const, peek };
  }

  const config = await getConfig();
  const provider = options.provider ?? normalizeFeishuAiProvider(config.creatorPublish?.feishuAiProvider);

  log(`${summaryPrefix} 步骤 1/2：飞书 AI 正文生成 (provider=${provider})`);
  try {
    await generateFeishuTaskAiContent({
      provider,
      logger: log,
      isCancelled: options.isCancelled,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log(`  ⚠️ AI 正文生成失败，继续执行导入: ${message}`);
  }

  log(`${summaryPrefix} 步骤 2/2：从飞书导入任务`);
  const importSummary = await importPublishTasksFromFeishu({
    autoStart: options.autoStart === true,
    allowCreate: options.allowCreate !== false,
    logger: log,
  });

  return { skipped: false, peek, importSummary };
}

export async function generateFeishuTaskAiContent(options: {
  provider?: "siliconflow" | "deepseek";
  logger?: (...args: unknown[]) => void;
  isCancelled?: () => boolean;
} = {}) {
  await prepareProjectConfigEnv("task");
  return await generateTaskAiContentToFeishu({
    provider: options.provider || "siliconflow",
    logger: options.logger || console.log,
    isCancelled: options.isCancelled,
    summaryPrefix: "[generate-feishu-ai-content-api]",
  });
}

function feishuCreatedTaskFieldIsYes(fields: Record<string, unknown> | undefined): boolean {
  return String((fields || {})["已创建任务"] ?? "").trim() === "是";
}

export async function writeFeishuTaskStatus(options: {
  recordId: string;
  statusText: string;
  approvalText?: string;
}) {
  await prepareProjectConfigEnv("task");

  const recordId = String(options.recordId || "").trim();
  const statusText = String(options.statusText || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const approvalText = String(options.approvalText || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!recordId) throw new Error("missing recordId");
  if (!statusText) throw new Error("missing statusText");

  const cfg = loadFeishuBitableConfigForProfile("task");
  const tokenCache = await getValidAccessToken(cfg);

  try {
    const existing = await getBitableRecord(cfg, tokenCache.accessToken, recordId);
    if (feishuCreatedTaskFieldIsYes(existing?.fields as Record<string, unknown> | undefined)) {
      return;
    }
  } catch {
    // 读失败时仍尝试写入，与原先「读审批失败仍更新」行为一致
  }

  const fields: Record<string, string> = { 已创建任务: statusText };
  if (approvalText) fields.审批 = approvalText;
  await updateBitableRecord(cfg, tokenCache.accessToken, recordId, fields);
}

export async function markFeishuTaskPublished(recordId: string) {
  let approvalText: string | undefined;

  try {
    await prepareProjectConfigEnv("task");

    const cfg = loadFeishuBitableConfigForProfile("task");
    const tokenCache = await getValidAccessToken(cfg);
    const record = await getBitableRecord(cfg, tokenCache.accessToken, recordId);

    if (feishuCreatedTaskFieldIsYes(record?.fields as Record<string, unknown> | undefined)) {
      return;
    }

    const approvalValue = String(record?.fields?.审批 ?? "").trim();
    if (approvalValue && approvalValue.includes("异常待修改")) {
      approvalText = "通过";
    }
  } catch {
    // 读取失败不阻塞写回，approvalText 保持 undefined
  }

  await writeFeishuTaskStatus({ recordId, statusText: "是", approvalText });
}
