/**
 * 从飞书 task 表读取数据 → 创建/更新发布任务
 *
 * 用法:
 *   node scripts/feishu/import-publish-tasks.js
 */
require("dotenv").config();

const { syncPublishTasks } = require("./sync-publish-tasks");

async function main() {
  const autoStart = process.argv.includes("--auto-start");
  await syncPublishTasks({
    autoStart,
    allowCreate: true,
    logger: (...args) => console.log(...args),
    summaryPrefix: "[import-publish-tasks]",
  });
}

main().catch((e) => {
  console.error("[import-publish-tasks] 执行失败:", e.message);
  process.exitCode = 1;
});
