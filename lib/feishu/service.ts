import dotenv from "dotenv";
import { getConfig } from "@/lib/configService";
import { normalizeFeishuAiContentMaxConcurrent } from "@/lib/feishuAiContentConcurrency";
import { normalizeFeishuAiProvider } from "@/lib/feishuAiProvider";
import { runWithArgs } from "@/lib/feishu/legacy-cli";
import {
  peekFeishuSyncCandidates,
  queueAutoRetryableFailedPublishTasks,
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
  dotenv.config({ quiet: true });
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
  summaryPrefix?: string;
} = {}) {
  await prepareProjectConfigEnv("task");
  return await peekFeishuSyncCandidates({
    logger: options.logger || console.log,
    summaryPrefix: options.summaryPrefix || "[peek-feishu-import-api]",
  });
}

export async function importPublishTasksFromFeishu(options: {
  autoStart?: boolean;
  allowCreate?: boolean;
  logger?: (...args: unknown[]) => void;
  verbose?: boolean;
} = {}) {
  await prepareProjectConfigEnv("task");
  return await syncPublishTasks({
    autoStart: options.autoStart === true,
    allowCreate: options.allowCreate !== false,
    logger: options.logger || console.log,
    verbose: options.verbose === true,
    summaryPrefix: "[import-publish-tasks-api]",
  });
}

export async function queueAutoRetryableFailedCreatorPublishTasks(options: {
  logger?: (...args: unknown[]) => void;
} = {}) {
  await prepareProjectConfigEnv("task");
  return await queueAutoRetryableFailedPublishTasks({
    logger: options.logger || console.log,
  });
}

/** 自动调度：先重试失败，再只给本次导入候选生成空正文，最后导入发布任务 */
export async function runFeishuPublishImportPipeline(options: {
  autoStart?: boolean;
  allowCreate?: boolean;
  logger?: (...args: unknown[]) => void;
  isCancelled?: () => boolean;
  summaryPrefix?: string;
} = {}) {
  const log = options.logger || console.log;
  const summaryPrefix = options.summaryPrefix || "[feishu-import-pipeline]";

  await prepareProjectConfigEnv("task");

  let earlyAutoRetrySummary: Awaited<
    ReturnType<typeof queueAutoRetryableFailedCreatorPublishTasks>
  > | null = null;

  if (options.autoStart === true) {
    log(`${summaryPrefix} 自动调度：先扫描本地可重试失败任务`);
    earlyAutoRetrySummary = await queueAutoRetryableFailedCreatorPublishTasks({
      logger: log,
    });
  }

  log(`${summaryPrefix} 扫描并从飞书导入任务`);
  const peek = await peekFeishuPublishImportCandidates({
    logger: () => {},
    summaryPrefix: `${summaryPrefix}-import-peek`,
  });
  log(
    `  预检：待导入 ${peek.syncCandidateCount} 条 / 可同步 ${peek.eligibleCount} 条 / 总 ${peek.totalRecords} 条` +
      (peek.remoteCreatedSkipCount
        ? `，飞书已创建跳过 ${peek.remoteCreatedSkipCount} 条`
        : "")
  );

  let targetedAiSummary: Awaited<ReturnType<typeof generateFeishuTaskAiContent>> | null = null;
  if (options.autoStart === true && peek.syncCandidateRecordIds?.length > 0) {
    log(
      `${summaryPrefix} 自动调度：仅为本次飞书导入候选中的空正文任务生成 AI 正文`
    );
    targetedAiSummary = await generateFeishuTaskAiContent({
      recordIds: peek.syncCandidateRecordIds,
      logger: log,
      isCancelled: options.isCancelled,
    });
  }

  const importSummary = await importPublishTasksFromFeishu({
    autoStart: options.autoStart === true,
    allowCreate: options.allowCreate !== false,
    logger: log,
    verbose: false,
  });

  return { peek, targetedAiSummary, importSummary, earlyAutoRetrySummary };
}

export async function generateFeishuTaskAiContent(options: {
  provider?: "siliconflow" | "deepseek";
  maxConcurrent?: number;
  recordIds?: string[];
  logger?: (...args: unknown[]) => void;
  isCancelled?: () => boolean;
} = {}) {
  await prepareProjectConfigEnv("task");
  const config = await getConfig();
  const provider = options.provider ?? normalizeFeishuAiProvider(config.creatorPublish?.feishuAiProvider);
  return await generateTaskAiContentToFeishu({
    provider,
    maxConcurrent:
      options.maxConcurrent ??
      normalizeFeishuAiContentMaxConcurrent(
        config.creatorPublish?.feishuAiContentMaxConcurrent
      ),
    recordIds: options.recordIds,
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
