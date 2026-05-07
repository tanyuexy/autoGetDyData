/**
 * 发布完成后回写飞书任务表：将对应行的「已创建任务」设为「是」
 *
 * 用法:
 *   node scripts/feishu/mark-task-published.js <recordId> [accountName]
 */
require("dotenv").config();

const { updateBitableRecord } = require("./lib/bitable");
const { loadFeishuBitableConfigForProfile } = require("./lib/config");
const { getValidAccessToken } = require("./lib/oauth");

async function main() {
  const recordId = (process.argv[2] || "").trim();
  if (!recordId) {
    console.error("[mark-task-published] 缺少 recordId 参数");
    process.exit(1);
  }

  const accountName = (process.argv[3] || "").trim() || "?";
  const cfg = loadFeishuBitableConfigForProfile("task");
  const tokenCache = await getValidAccessToken(cfg);

  await updateBitableRecord(cfg, tokenCache.accessToken, recordId, {
    已创建任务: "是",
  });

  console.log(
    `[mark-task-published] ✓ 已回写飞书 record ${recordId} (${accountName}): 已创建任务=是`
  );
}

main().catch((e) => {
  console.error("[mark-task-published] 回写失败:", e.message);
  process.exit(1);
});
