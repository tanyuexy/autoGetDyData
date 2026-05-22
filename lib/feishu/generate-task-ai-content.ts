import type { LlmProvider, JsonValue } from "@/lib/llm";
import { callStructuredLlm } from "@/lib/llm";
import { normalizeFeishuAiContentMaxConcurrent } from "@/lib/feishuAiContentConcurrency";
import { readBitable } from "@/lib/feishu/core/readBitable";
import { loadFeishuBitableConfigForProfile } from "@/lib/feishu/core/config";
import { getValidAccessToken } from "@/lib/feishu/core/oauth";
import { updateBitableRecord } from "@/lib/feishu/core/bitable";

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

  return { recordId, shopName, productText, productRecordIds, title, rowLabel };
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
  return process.env.SILICONFLOW_MODEL?.trim() || "(未设置 SILICONFLOW_MODEL)";
}

async function generateContent(
  provider: LlmProvider,
  task: TaskCandidate,
  product: ProductInfo,
  log: (...args: unknown[]) => void
): Promise<string> {
  const model = resolveModelName(provider);
  log(`    [AI] 厂商=${provider}，模型=${model}`);
  log(`    [AI] 提示词: ${product.copyPrompt.slice(0, 120)}${product.copyPrompt.length > 120 ? "..." : ""}`);

  const result = await callStructuredLlm<GeneratedContent>(provider, {
    schemaName: "feishu_task_content",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: {
          type: "string",
          description: "可直接写入飞书任务表正文字段的中文发布正文",
          minLength: 1,
        },
      },
      required: ["content"],
    },
    messages: [
      {
        role: "system",
        content:
          "你是抖音电商内容文案助手。请根据商品信息和文案提示词生成可直接发布的中文正文。只输出正文，不要解释；文案自然、有种草感；不要夸大功效，不要编造未提供的信息。",
      },
      {
        role: "user",
        content: [
          `所属店铺：${task.shopName || product.shopName || "未提供"}`,
          `商品名：${product.productName}`,
          task.title ? `任务标题：${task.title}` : "任务标题：未提供",
          `文案提示词：${product.copyPrompt}`,
        ].join("\n"),
      },
    ],
    temperature: 0.7,
    timeoutMs: AI_CONTENT_TIMEOUT_MS,
    validate: isGeneratedContent,
  });

  const content = result.data.content.trim();
  const usage = result.usage;
  log(`    [AI] 返回正文(${content.length}字): ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`);
  if (usage) {
    log(`    [AI] Token用量: prompt=${usage.promptTokens ?? "-"}, completion=${usage.completionTokens ?? "-"}, total=${usage.totalTokens ?? "-"}`);
  }

  return content;
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
        const content = await generateContent(provider, task, product, log);
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
  const provider = options.provider || "siliconflow";
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
