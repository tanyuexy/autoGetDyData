import { NextResponse } from "next/server";
import { getConfig } from "@/lib/configService";
import { readReviewItems } from "@/lib/review/service";
import { generateTaskIdWithTime } from "@/lib/tasks/taskManager";
import { appendTaskLog, appendTaskDone, ensureTaskLogMeta } from "@/lib/tasks/taskLogStore";
import { loadFeishuBitableConfigForProfile } from "@/lib/feishu/core/config";
import { getValidAccessToken } from "@/lib/feishu/core/oauth";
import { listAllBitableRecords, batchUpdateBitableRecords } from "@/lib/feishu/core/bitable";

function log(taskId: string, text: string, level: "info" | "warn" | "error" = "info") {
  // 单行输出，避免正文换行拆散日志
  const line = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  console.log(`[sync-feishu] ${line}`);
  appendTaskLog(taskId, { level, text: line });
}

function extractShopName(shopField: unknown): string {
  if (!shopField) return "";
  if (typeof shopField === "string") return shopField.trim();
  if (Array.isArray(shopField)) {
    for (const item of shopField) {
      if (item && typeof item.text === "string" && item.text.trim()) {
        return item.text.trim();
      }
    }
  }
  return "";
}

function isCreatedTask(fields: Record<string, unknown> | undefined): boolean {
  return String((fields || {})["已创建任务"] ?? "").trim() === "是";
}

/** 与发布任务导入规则一致：仅「审批」或「审核」列为「通过」才参与回填链接 */
function isApprovalPassed(fields: Record<string, unknown> | undefined): boolean {
  const f = fields || {};
  const approval = String(f["审批"] ?? f["审核"] ?? "").trim();
  return approval === "通过";
}

/** 去除所有符号、空格，只保留中文汉字和字母数字 */
function clean(s: string): string {
  return s.replace(/[^\w一-鿿]/g, "").toLowerCase();
}

/** 最长公共子串长度 */
function longestCommonSubstring(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let maxLen = 0;
  const prev = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    let diag = 0;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      if (a[i - 1] === b[j - 1]) {
        prev[j] = diag + 1;
        if (prev[j] > maxLen) maxLen = prev[j];
      } else {
        prev[j] = 0;
      }
      diag = tmp;
    }
  }
  return maxLen;
}

/**
 * 去除所有符号、空格，只保留中文汉字和字母数字，文本匹配
 */
function titleMatchBody(title: string, feishuBody: string): boolean {
  const ct = clean(title);
  const ce = clean(feishuBody);
  if (!ct || !ce) return false;
  if (ce.includes(ct) || ct.includes(ce)) return true;

  // 最长公共子串 ≥ 较短文本的 50%
  const lcs = longestCommonSubstring(ct, ce);
  const minLen = Math.min(ct.length, ce.length);
  if (minLen > 0 && lcs / minLen >= 0.5) return true;

  return false;
}

export async function POST() {
  const taskId = generateTaskIdWithTime("review-sync");
  ensureTaskLogMeta(taskId, { namespace: "review-sync" });

  const startTime = Date.now();
  let matched = 0;
  let updated = 0;

  try {
    log(taskId, "开始同步作品链接到飞书...");

    const projectConfig = await getConfig();
    process.env.PROJECT_CONFIG_JSON = JSON.stringify(projectConfig);

    const cfg = loadFeishuBitableConfigForProfile("task");
    const tokenCache = await getValidAccessToken(cfg);
    const accessToken = tokenCache.accessToken;
    log(taskId, "飞书 Token 已获取");

    log(taskId, "正在读取飞书任务多维表格...");
    const allRecords = await listAllBitableRecords(cfg, accessToken);
    log(taskId, `飞书表格共 ${allRecords.length} 条记录`);

    const createdRecords = allRecords.filter((r: any) => {
      if (!isApprovalPassed(r?.fields)) return false;
      if (!isCreatedTask(r?.fields)) return false;
      const existingLink = String((r?.fields || {})["视频链接"] ?? "").trim();
      if (existingLink) return false;
      return true;
    });
    log(taskId, `审批/审核通过且已创建任务且无链接: ${createdRecords.length} 条`);

    if (createdRecords.length === 0) {
      log(taskId, "没有需要同步的记录，完成");
      appendTaskDone(taskId, 0, "没有需要同步的记录");
      return NextResponse.json({ taskId });
    }

    log(taskId, "正在读取作品信息...");
    const reviewItems = await readReviewItems();
    log(taskId, `作品信息共 ${reviewItems.length} 条`);

    if (reviewItems.length === 0) {
      log(taskId, "作品信息表为空，无法匹配");
      appendTaskDone(taskId, 0, "作品信息表为空");
      return NextResponse.json({ taskId });
    }

    // 按账号分组 review items
    const byAccount: Record<string, typeof reviewItems> = {};
    for (const item of reviewItems) {
      if (!item.title || !item.workLink) continue;
      const name = item.accountName;
      if (!byAccount[name]) byAccount[name] = [];
      byAccount[name].push(item);
    }

    log(taskId, "开始匹配...");
    const updates: { record_id: string; fields: Record<string, any> }[] = [];
    const unmatchedLines: string[] = [];

    for (const record of createdRecords) {
      const fields = record.fields || {};
      const feishuBody = String(fields["正文"] ?? "").trim();
      const shopName = extractShopName(fields["所属店铺"]);

      if (!shopName || !feishuBody) continue;

      const candidates = byAccount[shopName] || [];
      if (candidates.length === 0) {
        unmatchedLines.push(`${shopName} - 无该账号的作品数据`);
        continue;
      }

      const hits = candidates.filter((item) => titleMatchBody(item.title, feishuBody));

      if (hits.length > 0) {
        const best = hits.reduce((a, b) =>
          (a.checkedAt || "") > (b.checkedAt || "") ? a : b
        );
        updates.push({
          record_id: record.record_id,
          fields: { 视频链接: { link: best.workLink!, text: best.workLink! } },
        });
        matched++;
        log(taskId, `✓ ${shopName} | ${best.title.slice(0, 50)} → ${best.workLink}`);
      } else {
        unmatchedLines.push(`${shopName} | 正文前50字: ${feishuBody.slice(0, 50).replace(/\n/g, " ")}`);
      }
    }

    // 汇总未匹配
    if (unmatchedLines.length > 0) {
      log(taskId, `--- 未匹配 ${unmatchedLines.length} 条 ---`, "warn");
      for (const line of unmatchedLines) {
        log(taskId, `  ${line}`, "warn");
      }
    }

    log(taskId, `匹配结果: ${matched}/${createdRecords.length}`);

    if (updates.length > 0) {
      log(taskId, `正在批量更新 ${updates.length} 条记录...`);
      const batchSize = 500;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        try {
          const result = await batchUpdateBitableRecords(cfg, accessToken, batch);
          updated += result.updated || batch.length;
          log(taskId, `  批次 ${Math.floor(i / batchSize) + 1}: 更新 ${result.updated || batch.length} 条`);
        } catch (e: any) {
          log(taskId, `  批量更新失败: ${e.message}`, "error");
        }
      }
    }

    const elapsedMs = Date.now() - startTime;
    const summary = `匹配 ${matched} 条, 更新 ${updated} 条, 耗时 ${(elapsedMs / 1000).toFixed(1)}s`;
    log(taskId, summary);
    appendTaskDone(taskId, 0, summary);

    return NextResponse.json({ taskId });
  } catch (e: any) {
    log(taskId, `执行失败: ${e.message || e}`, "error");
    appendTaskDone(taskId, 1, e.message || "执行失败");
    return NextResponse.json({ taskId }, { status: 500 });
  }
}
