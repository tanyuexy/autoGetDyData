/**
 * 回写飞书任务表字段，可写「已创建任务」并可选联动更新「审批」
 *
 * 用法:
 *   node scripts/feishu/write-task-created-status.js <recordId> <statusText> [accountName] [approvalText]
 */
require("dotenv").config();

const { updateBitableRecord } = require("./lib/bitable");
const { loadFeishuBitableConfigForProfile } = require("./lib/config");
const { getValidAccessToken } = require("./lib/oauth");

function normalizeStatusText(input) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

async function main() {
  const recordId = String(process.argv[2] || "").trim();
  const statusText = normalizeStatusText(process.argv[3] || "");
  const accountName = String(process.argv[4] || "").trim() || "?";
  const approvalText = normalizeStatusText(process.argv[5] || "");

  if (!recordId) {
    console.error("[write-task-created-status] 缺少 recordId 参数");
    process.exit(1);
  }
  if (!statusText) {
    console.error("[write-task-created-status] 缺少 statusText 参数");
    process.exit(1);
  }

  const cfg = loadFeishuBitableConfigForProfile("task");
  const tokenCache = await getValidAccessToken(cfg);

  const fields = {
    已创建任务: statusText,
  };
  if (approvalText) {
    fields.审批 = approvalText;
  }

  await updateBitableRecord(cfg, tokenCache.accessToken, recordId, fields);

  console.log(
    `[write-task-created-status] ✓ 已回写飞书 record ${recordId} (${accountName}): 已创建任务=${statusText}${approvalText ? `, 审批=${approvalText}` : ""}`
  );
}

main().catch((e) => {
  console.error("[write-task-created-status] 回写失败:", e.message);
  process.exit(1);
});
