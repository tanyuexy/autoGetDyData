/**
 * 发布脚本统一日志工具
 *
 * 日志层级：
 *   stage   — 阶段标题（带分隔线）
 *   step    — 操作步骤（→ 前缀）
 *   checkOk — 校验通过（✓ 前缀）
 *   done    — 阶段完成确认
 */

const LINE = "────────────────────────────────────────";

function stage(index, text) {
  console.log(`\n${LINE}`);
  console.log(`阶段 ${index}  ${text}`);
  console.log(LINE);
}

function step(text) {
  console.log(`  →  ${text}`);
}

function checkOk(text) {
  console.log(`  ✓  ${text}`);
}

function done(index) {
  console.log(`  ✔  阶段 ${index} 完成`);
}

function info(text) {
  console.log(`     ${text}`);
}

module.exports = { stage, step, checkOk, done, info, LINE };
