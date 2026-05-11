/**
 * 回写飞书任务表的「已创建任务」列
 *
 * 用法:
 *   node scripts/feishu/write-task-created-status.js <recordId> <statusText> [accountName]
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

  await updateBitableRecord(cfg, tokenCache.accessToken, recordId, {
    已创建任务: statusText,
  });

  console.log(
    `[write-task-created-status] ✓ 已回写飞书 record ${recordId} (${accountName}): 已创建任务=${statusText}`
  );
}

main().catch((e) => {
  console.error("[write-task-created-status] 回写失败:", e.message);
  process.exit(1);
});
