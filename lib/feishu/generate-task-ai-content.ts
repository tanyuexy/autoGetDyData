import type { LlmProvider, JsonValue } from "@/lib/llm";
import { callStructuredLlm } from "@/lib/llm";
import { bufferToImageDataUrl, understandMiniMaxImage } from "@/lib/llm/minimax-vision";
import { normalizeFeishuAiContentMaxConcurrent } from "@/lib/feishu/aiContentConcurrency";
import { readBitable } from "@/lib/feishu/core/readBitable";
import { loadFeishuBitableConfigForProfile } from "@/lib/feishu/core/config";
import { getValidAccessToken } from "@/lib/feishu/core/oauth";
import { updateBitableRecord } from "@/lib/feishu/core/bitable";
import { downloadFeishuAttachmentCached } from "@/lib/feishu/attachment-download-cache";
import {
  FEISHU_AI_CONTENT_FORMAT_HINT,
  validateFeishuAiGeneratedContent,
} from "@/lib/creator-publish/publishDescription";
import path from "node:path";
import fse from "fs-extra";

type FeishuRecord = {
  record_id?: string;
  fields?: Record<string, unknown>;
  [key: string]: unknown;
};

type TaskCandidate = {
  recordId: string;
  shopName: string;
  productText: string;
  productRecordIds: string[];
  title: string;
  rowLabel: string;
  attachments: FeishuAttachment[];
};

type FeishuAttachment = {
  fileToken: string;
  name: string;
  type: string;
  size: number;
};

type ProductInfo = {
  recordId: string;
  productName: string;
  shopName: string;
  copyPrompt: string;
};

/** 飞书 AI 正文生成单次 LLM 请求超时（默认 3 分钟，可用 FEISHU_AI_CONTENT_TIMEOUT_MS 覆盖） */
const AI_CONTENT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.FEISHU_AI_CONTENT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
})();

const AI_IMAGE_MAX_COUNT = (() => {
  const raw = Number(process.env.FEISHU_AI_MAX_IMAGES);
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), 20) : 1;
})();

const AI_CONTENT_MAX_RETRIES = (() => {
  const raw = Number(process.env.FEISHU_AI_CONTENT_MAX_RETRIES);
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), 5) : 3;
})();

const IMAGE_MATERIAL_ANALYSIS_PROMPT =
  "请详细描述这张抖音图文素材图片，供撰写发布正文参考：可见的产品/包装、文字信息、场景、人物动作、色调氛围、卖点线索。只描述能看清的内容，不要编造。";

type ProductIndexes = {
  byRecordId: Map<string, ProductInfo>;
  byShopAndName: Map<string, ProductInfo>;
  byName: Map<string, ProductInfo[]>;
};

type GeneratedContent = JsonValue & { content: string };

function normalizeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return normalizeText(obj.text ?? obj.name ?? obj.link ?? obj.value ?? "");
  }

  return "";
}

function extractRelationRecordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const rawIds = obj.recordIds ?? obj.record_ids;
    if (Array.isArray(rawIds)) {
      for (const id of rawIds) {
        if (id) ids.push(String(id));
      }
    }
    const single = obj.recordId ?? obj.record_id;
    if (single) ids.push(String(single));
  }

  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function normalizeKey(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function compositeKey(shopName: string, productName: string): string {
  return `${normalizeKey(shopName)}::${normalizeKey(productName)}`;
}

function parseFeishuAttachments(value: unknown): FeishuAttachment[] {
  if (!Array.isArray(value)) return [];

  const attachments: FeishuAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const fileToken = String(obj.file_token || obj.fileToken || "").trim();
    if (!fileToken) continue;
    attachments.push({
      fileToken,
      name: String(obj.name || fileToken).trim(),
      type: String(obj.type || "").trim(),
      size: Number(obj.size || 0),
    });
  }
  return attachments;
}

function isImageAttachment(att: FeishuAttachment): boolean {
  const mime = att.type.toLowerCase();
  if (mime.startsWith("image/")) return true;
  const ext = path.extname(att.name).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext);
}

function isVideoAttachment(att: FeishuAttachment): boolean {
  const mime = att.type.toLowerCase();
  if (mime.startsWith("video/")) return true;
  const ext = path.extname(att.name).toLowerCase();
  return [".mp4", ".mov", ".webm", ".avi", ".mkv"].includes(ext);
}

function shouldAnalyzeImageMaterials(attachments: FeishuAttachment[]): boolean {
  const images = attachments.filter(isImageAttachment);
  if (images.length === 0) return false;
  return !attachments.some(isVideoAttachment);
}

function selectImagesForAnalysis(attachments: FeishuAttachment[]): FeishuAttachment[] {
  return attachments.filter(isImageAttachment).slice(0, AI_IMAGE_MAX_COUNT);
}

function parseTaskRecord(record: FeishuRecord): TaskCandidate | null {
  const fields = record.fields || {};
  const recordId = String(record.record_id || "").trim();
  if (!recordId) return null;

  const body = normalizeText(fields["正文"]);
  if (body) return null;

  const remark = normalizeText(fields["备注"]);
  if (remark === "示例") return null;

  const productField = fields["挂车产品名"];
  const productText = normalizeText(productField);
  const productRecordIds = extractRelationRecordIds(productField);
  if (!productText && productRecordIds.length === 0) return null;

  const shopName = normalizeText(fields["所属店铺"]);
  const title = normalizeText(fields["标题（可为空）"]);
  const rowLabel = [shopName, productText, title].filter(Boolean).join(" | ") || recordId;

  return {
    recordId,
    shopName,
    productText,
    productRecordIds,
    title,
    rowLabel,
    attachments: parseFeishuAttachments(fields["视频/图文内容"]),
  };
}

function parseProductRecord(record: FeishuRecord): ProductInfo | null {
  const fields = record.fields || {};
  const recordId = String(record.record_id || "").trim();
  const productName = normalizeText(fields["商品名"]);
  if (!recordId || !productName) return null;

  return {
    recordId,
    productName,
    shopName: normalizeText(fields["所属店铺"]),
    copyPrompt: normalizeText(fields["文案提示词"]),
  };
}

function buildProductIndexes(products: ProductInfo[]): ProductIndexes {
  const byRecordId = new Map<string, ProductInfo>();
  const byShopAndName = new Map<string, ProductInfo>();
  const byName = new Map<string, ProductInfo[]>();

  for (const product of products) {
    byRecordId.set(product.recordId, product);
    if (product.shopName) byShopAndName.set(compositeKey(product.shopName, product.productName), product);

    const nameKey = normalizeKey(product.productName);
    const list = byName.get(nameKey) || [];
    list.push(product);
    byName.set(nameKey, list);
  }

  return { byRecordId, byShopAndName, byName };
}

function resolveProductForTask(task: TaskCandidate, indexes: ProductIndexes): ProductInfo | null {
  for (const id of task.productRecordIds) {
    const product = indexes.byRecordId.get(id);
    if (product) return product;
  }

  if (task.shopName && task.productText) {
    const product = indexes.byShopAndName.get(compositeKey(task.shopName, task.productText));
    if (product) return product;
  }

  if (task.productText) {
    const matches = indexes.byName.get(normalizeKey(task.productText)) || [];
    if (matches.length === 1) return matches[0];
  }

  return null;
}

function isGeneratedContent(value: unknown): value is GeneratedContent {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { content?: unknown }).content === "string" &&
    (value as { content: string }).content.trim()
  );
}

function resolveModelName(provider: LlmProvider): string {
  if (provider === "deepseek") {
    return process.env.DEEPSEEK_MODEL?.trim() || "(未设置 DEEPSEEK_MODEL)";
  }
  if (provider === "minimax") {
    return process.env.MINIMAX_MODEL?.trim() || "MiniMax-M2.7";
  }
  return process.env.SILICONFLOW_MODEL?.trim() || "(未设置 SILICONFLOW_MODEL)";
}

async function buildImageMaterialContext(options: {
  attachments: FeishuAttachment[];
  taskCfg: ReturnType<typeof loadFeishuBitableConfigForProfile>;
  accessToken: string;
  log: (...args: unknown[]) => void;
}): Promise<string> {
  if (!shouldAnalyzeImageMaterials(options.attachments)) return "";

  const allImages = options.attachments.filter(isImageAttachment);
  const images = selectImagesForAnalysis(options.attachments);
  if (images.length === 0) return "";

  if (allImages.length > images.length) {
    options.log(
      `    [AI] 素材共 ${allImages.length} 张图，按配置仅理解前 ${images.length} 张`
    );
  }

  const sections: string[] = [];

  for (let index = 0; index < images.length; index++) {
    const att = images[index];
    try {
      options.log(`    [AI] 准备素材图 ${index + 1}/${images.length}: ${att.name}`);
      const cached = await downloadFeishuAttachmentCached({
        config: options.taskCfg,
        accessToken: options.accessToken,
        attachment: {
          fileToken: att.fileToken,
          name: att.name,
          type: att.type,
          size: att.size,
        },
        log: (message) => options.log(`    [AI] ${message}`),
      });
      const buffer = await fse.readFile(cached.filePath);
      const dataUrl = bufferToImageDataUrl(buffer, att.type, att.name);
      const description = await understandMiniMaxImage({
        prompt: IMAGE_MATERIAL_ANALYSIS_PROMPT,
        imageUrl: dataUrl,
        timeoutMs: AI_CONTENT_TIMEOUT_MS,
      });
      sections.push(`【图${index + 1} · ${att.name}】\n${description.trim()}`);
      options.log(
        `    [AI] 素材图理解完成 ${index + 1}/${images.length}: ${att.name}${cached.reused ? "（缓存）" : ""}`
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      options.log(`    [AI] ⚠️ 素材图理解失败: ${att.name}，${message}`);
    }
  }

  if (sections.length === 0) return "";
  return `\n素材图片理解（共${sections.length}张）：\n${sections.join("\n\n")}`;
}

function buildAiContentSystemPrompt(hasImageMaterial: boolean): string {
  const base = hasImageMaterial
    ? "你是抖音电商内容文案助手。请结合商品信息、文案提示词和素材图片理解结果，生成可直接发布的中文内容。正文应与图片内容一致；"
    : "你是抖音电商内容文案助手。请根据商品信息和文案提示词生成可直接发布的中文内容。";

  return (
    `${base}文案自然、有种草感；不要夸大功效，不要编造未提供的信息；若遇药品/保健品，只写合规种草表述，不要拒答。` +
    `正文不要出现店铺名称、店名或账号名。` +
    `${FEISHU_AI_CONTENT_FORMAT_HINT}按文案提示词要求的风格撰写正文，不要输出解释。`
  );
}

function buildAiContentUserMessage(options: {
  task: TaskCandidate;
  product: ProductInfo;
  imageMaterialContext: string;
  formatRetryHint?: string;
}): string {
  return [
    options.formatRetryHint,
    `商品名：${options.product.productName}`,
    options.task.title ? `任务标题：${options.task.title}` : "任务标题：未提供",
    `文案提示词：${options.product.copyPrompt}`,
    options.imageMaterialContext,
  ]
    .filter(Boolean)
    .join("\n");
}

async function requestAiContentOnce(
  provider: LlmProvider,
  options: {
    task: TaskCandidate;
    product: ProductInfo;
    imageMaterialContext: string;
    systemPrompt: string;
    userContent: string;
  }
): Promise<{ content: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }> {
  const result = await callStructuredLlm<GeneratedContent>(provider, {
    schemaName: "feishu_task_content",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: {
          type: "string",
          description:
            "抖音发布描述：正文段落 + 空行 + 末行 #话题标签（空格分隔）；正文与标签都必须存在",
          minLength: 1,
        },
      },
      required: ["content"],
    },
    messages: [
      {
        role: "system",
        content: options.systemPrompt,
      },
      {
        role: "user",
        content: options.userContent,
      },
    ],
    temperature: 0.7,
    timeoutMs: AI_CONTENT_TIMEOUT_MS,
    validate: isGeneratedContent,
  });

  return { content: result.data.content.trim(), usage: result.usage };
}

async function generateContent(
  provider: LlmProvider,
  task: TaskCandidate,
  product: ProductInfo,
  imageMaterialContext: string,
  log: (...args: unknown[]) => void
): Promise<string> {
  const model = resolveModelName(provider);
  log(`    [AI] 厂商=${provider}，模型=${model}`);
  if (imageMaterialContext) {
    const analyzedCount = selectImagesForAnalysis(task.attachments).length;
    log(`    [AI] 已结合 ${analyzedCount} 张素材图理解结果`);
  }
  log(`    [AI] 提示词: ${product.copyPrompt.slice(0, 120)}${product.copyPrompt.length > 120 ? "..." : ""}`);

  const systemPrompt = buildAiContentSystemPrompt(Boolean(imageMaterialContext));
  let formatRetryHint = "";
  let lastReason = "未知错误";

  for (let attempt = 1; attempt <= AI_CONTENT_MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      log(`    [AI] 第 ${attempt}/${AI_CONTENT_MAX_RETRIES} 次重试…`);
    }

    try {
      const { content, usage } = await requestAiContentOnce(provider, {
        task,
        product,
        imageMaterialContext,
        systemPrompt,
        userContent: buildAiContentUserMessage({
          task,
          product,
          imageMaterialContext,
          formatRetryHint,
        }),
      });

      log(`    [AI] 返回正文(${content.length}字): ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`);
      if (usage) {
        log(
          `    [AI] Token用量: prompt=${usage.promptTokens ?? "-"}, completion=${usage.completionTokens ?? "-"}, total=${usage.totalTokens ?? "-"}`
        );
      }

      const validation = validateFeishuAiGeneratedContent(content);
      if (validation.ok) {
        if (validation.parts.normalizedText !== content) {
          log(`    [AI] 已规范化正文格式（正文 + 末行话题标签）`);
        }
        return validation.parts.normalizedText;
      }

      lastReason = validation.reason;
      log(`    [AI] 格式校验失败(${attempt}/${AI_CONTENT_MAX_RETRIES}): ${lastReason}`);
      formatRetryHint =
        `【格式修正】上次输出未通过校验：${lastReason}。请重新生成并严格遵守：${FEISHU_AI_CONTENT_FORMAT_HINT}`;
    } catch (error: unknown) {
      lastReason = error instanceof Error ? error.message : String(error);
      log(`    [AI] 请求失败(${attempt}/${AI_CONTENT_MAX_RETRIES}): ${lastReason}`);
      if (attempt >= AI_CONTENT_MAX_RETRIES) break;
    }
  }

  throw new Error(`AI 正文生成失败（已尝试 ${AI_CONTENT_MAX_RETRIES} 次）: ${lastReason}`);
}

async function loadAiContentCandidateContext() {
  const taskData = await readBitable("task", { recordsOnly: true });
  const productData = await readBitable("product", { recordsOnly: true });
  const taskRecords = (Array.isArray(taskData.records) ? taskData.records : []) as FeishuRecord[];
  const productRecords = (Array.isArray(productData.records) ? productData.records : []) as FeishuRecord[];
  const products = productRecords.map(parseProductRecord).filter(Boolean) as ProductInfo[];
  const indexes = buildProductIndexes(products);
  const candidates = taskRecords.map(parseTaskRecord).filter(Boolean) as TaskCandidate[];
  return { taskRecords, products, indexes, candidates };
}

function filterCandidatesByRecordIds(
  candidates: TaskCandidate[],
  recordIds?: string[]
): TaskCandidate[] {
  if (!recordIds || recordIds.length === 0) return candidates;
  const allowed = new Set(recordIds.map((id) => String(id || "").trim()).filter(Boolean));
  if (allowed.size === 0) return candidates;
  return candidates.filter((candidate) => allowed.has(candidate.recordId));
}

function classifyAiContentCandidates(
  candidates: TaskCandidate[],
  indexes: ProductIndexes
): {
  generatable: TaskCandidate[];
  generatableCount: number;
  skippedNoProductCount: number;
  skippedNoPromptCount: number;
} {
  const generatable: TaskCandidate[] = [];
  let skippedNoProductCount = 0;
  let skippedNoPromptCount = 0;

  for (const task of candidates) {
    const product = resolveProductForTask(task, indexes);
    if (!product) {
      skippedNoProductCount++;
      continue;
    }
    if (!product.copyPrompt) {
      skippedNoPromptCount++;
      continue;
    }
    generatable.push(task);
  }

  return {
    generatable,
    generatableCount: generatable.length,
    skippedNoProductCount,
    skippedNoPromptCount,
  };
}

/** 扫描任务表：正文为空且能匹配商品+文案提示词的可生成条数（不调用 LLM） */
export async function peekFeishuAiContentCandidates(options: {
  logger?: (...args: unknown[]) => void;
  summaryPrefix?: string;
} = {}) {
  const log = options.logger || console.log;
  const summaryPrefix = options.summaryPrefix || "[peek-feishu-ai-content]";

  log(`${summaryPrefix} 扫描飞书任务表 AI 正文候选...`);
  const { taskRecords, indexes, candidates } = await loadAiContentCandidateContext();
  const classified = classifyAiContentCandidates(candidates, indexes);

  log(
    `  任务表 ${taskRecords.length} 条，正文为空 ${candidates.length} 条，可生成 ${classified.generatableCount} 条` +
      (classified.skippedNoProductCount
        ? `（无商品匹配 ${classified.skippedNoProductCount}）`
        : "") +
      (classified.skippedNoPromptCount
        ? `（文案提示词为空 ${classified.skippedNoPromptCount}）`
        : "")
  );

  return {
    totalTaskCount: taskRecords.length,
    emptyBodyCount: candidates.length,
    ...classified,
  };
}

async function runGeneratableWithConcurrency(options: {
  generatable: TaskCandidate[];
  generatableCount: number;
  indexes: ProductIndexes;
  provider: LlmProvider;
  maxConcurrent: number;
  taskCfg: ReturnType<typeof loadFeishuBitableConfigForProfile>;
  accessToken: string;
  log: (...args: unknown[]) => void;
  isCancelled: () => boolean;
  summaryPrefix: string;
}): Promise<{ generatedCount: number; failedCount: number; cancelled: boolean }> {
  const {
    generatable,
    generatableCount,
    indexes,
    provider,
    maxConcurrent,
    taskCfg,
    accessToken,
    log,
    isCancelled,
    summaryPrefix,
  } = options;

  let cursor = 0;

  const worker = async () => {
    let localGenerated = 0;
    let localFailed = 0;
    let localCancelled = false;

    while (true) {
      if (isCancelled()) {
        localCancelled = true;
        break;
      }

      const taskIndex = cursor++;
      if (taskIndex >= generatable.length) break;

      const task = generatable[taskIndex];
      const displayIndex = taskIndex + 1;
      const product = resolveProductForTask(task, indexes);
      if (!product?.copyPrompt) continue;

      try {
        log(`  [${displayIndex}/${generatableCount}] ✎ 生成: ${task.rowLabel} -> ${product.productName}`);
        const imageMaterialContext = await buildImageMaterialContext({
          attachments: task.attachments,
          taskCfg,
          accessToken,
          log,
        });
        const content = await generateContent(
          provider,
          task,
          product,
          imageMaterialContext,
          log
        );
        await updateBitableRecord(taskCfg, accessToken, task.recordId, { 正文: content });
        localGenerated++;
        log(`  [${displayIndex}/${generatableCount}] ✓ 写回成功: ${task.rowLabel} (recordId=${task.recordId})`);
      } catch (error: unknown) {
        localFailed++;
        const message = error instanceof Error ? error.message : String(error);
        log(`  [${displayIndex}/${generatableCount}] ✗ 失败: ${task.rowLabel}，${message}`);
      }
    }

    return { generatedCount: localGenerated, failedCount: localFailed, cancelled: localCancelled };
  };

  const workerCount = Math.min(maxConcurrent, generatable.length);
  const results = await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const generatedCount = results.reduce((sum, item) => sum + item.generatedCount, 0);
  const failedCount = results.reduce((sum, item) => sum + item.failedCount, 0);
  const cancelled = results.some((item) => item.cancelled);

  if (cancelled) {
    log(`${summaryPrefix} 已取消，停止生成`);
  }

  return { generatedCount, failedCount, cancelled };
}

export async function generateTaskAiContentToFeishu(options: {
  provider?: LlmProvider;
  maxConcurrent?: number;
  recordIds?: string[];
  logger?: (...args: unknown[]) => void;
  isCancelled?: () => boolean;
  summaryPrefix?: string;
} = {}) {
  const provider = options.provider || "minimax";
  const log = options.logger || console.log;
  const isCancelled = options.isCancelled || (() => false);
  const summaryPrefix = options.summaryPrefix || "[generate-feishu-ai-content]";

  const maxConcurrent = normalizeFeishuAiContentMaxConcurrent(options.maxConcurrent);
  const model = resolveModelName(provider);
  log(
    `${summaryPrefix} 开始读取飞书表格，厂商=${provider}，模型=${model}，并发=${maxConcurrent}`
  );
  const { taskRecords, products, indexes, candidates } = await loadAiContentCandidateContext();
  const targetCandidates = filterCandidatesByRecordIds(candidates, options.recordIds);
  const { generatable, generatableCount, skippedNoProductCount, skippedNoPromptCount } =
    classifyAiContentCandidates(targetCandidates, indexes);

  log(
    `${summaryPrefix} 任务表 ${taskRecords.length} 条，正文为空 ${candidates.length} 条` +
      (options.recordIds?.length ? `，本次目标 ${targetCandidates.length} 条` : "") +
      `，可生成 ${generatableCount} 条，商品信息 ${products.length} 条`
  );
  if (generatable.length > 0) {
    log(`${summaryPrefix} 待生成列表（前10条）:`);
    for (const c of generatable.slice(0, 10)) {
      log(`  - ${c.rowLabel}${c.productRecordIds.length ? ` [关联ID: ${c.productRecordIds.join(",")}]` : ""}`);
    }
    if (generatable.length > 10) log(`  ... 共 ${generatable.length} 条`);
  }

  if (generatableCount === 0) {
    log(`${summaryPrefix} 没有满足 AI 正文生成条件的任务，跳过生成`);
    return {
      totalTaskCount: taskRecords.length,
      emptyBodyCount: candidates.length,
      targetEmptyBodyCount: targetCandidates.length,
      generatableCount: 0,
      generatedCount: 0,
      skippedNoProductCount,
      skippedNoPromptCount,
      failedCount: 0,
    };
  }

  const taskCfg = loadFeishuBitableConfigForProfile("task");
  const tokenCache = await getValidAccessToken(taskCfg);
  const accessToken = tokenCache.accessToken;

  const { generatedCount, failedCount } = await runGeneratableWithConcurrency({
    generatable,
    generatableCount,
    indexes,
    provider,
    maxConcurrent,
    taskCfg,
    accessToken,
    log,
    isCancelled,
    summaryPrefix,
  });

  const summary = {
    totalTaskCount: taskRecords.length,
    emptyBodyCount: candidates.length,
    targetEmptyBodyCount: targetCandidates.length,
    generatableCount,
    maxConcurrent,
    generatedCount,
    skippedNoProductCount,
    skippedNoPromptCount,
    failedCount,
  };
  log(
    `${summaryPrefix} 完成：正文为空 ${summary.emptyBodyCount}，可生成 ${summary.generatableCount}，已生成 ${summary.generatedCount}，无商品 ${summary.skippedNoProductCount}，无提示词 ${summary.skippedNoPromptCount}，失败 ${summary.failedCount}`
  );
  return summary;
}
