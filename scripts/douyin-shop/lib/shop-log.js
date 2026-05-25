/** 抖店导出 task log：统一走 stdout 的 [INFO]/[WARN]，便于 worker 正确分级。 */

function logInfo(msg) {
  console.log(`[INFO] ${msg}`);
}

function logWarn(msg) {
  console.log(`[WARN] ${msg}`);
}

function logError(msg) {
  console.error(`[ERROR] ${msg}`);
}

function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

function kindLabel(kind) {
  if (kind === "video") return "视频";
  if (kind === "graphic") return "图文";
  return "";
}

function shortStepTitle(title) {
  const text = String(title || "").trim();
  const exact = {
    检查缓存登录态: "检查登录态",
    打开抖店登录页: "打开登录页",
    识别登录页阶段: "识别登录阶段",
    保存跳转后的登录态: "保存登录态",
    保存登录态: "保存登录态",
    识别登录后页面阶段: "识别页面阶段",
    选择目标店铺: "选店",
    切换到第一个目标店铺: "切首家",
    等待店铺页面稳定: "等待页面",
    预热短视频明细页: "预热视频页",
    进入短视频明细页: "进入页面",
    选择短视频自然日: "选自然日",
    切换短视频非投放: "非投放",
    下载短视频明细文件: "下载",
    写入短视频数据日期: "写日期",
    进入图文分析页: "进入页面",
    选择图文自然日: "选自然日",
    下载图文明细文件: "下载",
    写入图文数据日期: "写日期",
    切换到下一个目标店铺: "下一家"
  };
  if (exact[text]) return exact[text];
  return text.replace(/^跳过/, "跳过·");
}

function inferPhase(index, meta = {}) {
  if (meta.phase) return meta.phase;
  const n = Number(index);
  if (n >= 8000) return "switch";
  if (n >= 1000) return "shop";
  if (n >= 10 && n < 100) return "prepare";
  if (n > 0 && n < 10) return "login";
  return "shop";
}

function formatDayPart(meta = {}) {
  if (meta.offset != null && meta.daysToExport) {
    return `D${Number(meta.offset) + 1}/${meta.daysToExport}`;
  }
  const dataDate = String(meta.dataDate || "").trim();
  if (!dataDate) return "";
  const parts = dataDate.split("/");
  if (parts.length >= 3) return parts.slice(1).join("/");
  return dataDate;
}

function formatStepRef({ index, title, meta = {} }) {
  const phase = inferPhase(index, meta);
  const step = shortStepTitle(title);

  if (phase === "login") {
    return `登录·${step}`;
  }
  if (phase === "switch") {
    const pos =
      meta.shopIndex && meta.shopTotal
        ? `${meta.shopIndex}/${meta.shopTotal}`
        : "";
    return pos ? `切店 ${pos}·${step}` : `切店·${step}`;
  }
  if (phase === "prepare") {
    const shop = meta.shopName ? String(meta.shopName) : "";
    return shop ? `准备 ${shop}·${step}` : `准备·${step}`;
  }

  const shopPos =
    meta.shopIndex && meta.shopTotal
      ? `${meta.shopIndex}/${meta.shopTotal}`
      : meta.shopName
        ? String(meta.shopName)
        : "";
  const kind = kindLabel(meta.kind);
  const dayPart = formatDayPart(meta);
  const daySteps = /自然日|下载|写.*日期|非投放/.test(String(title));
  const chunks = [shopPos, kind, daySteps && dayPart ? dayPart : "", step].filter(
    Boolean
  );
  return chunks.join(" ");
}

function logStepResult({ index, title, status, durationMs, meta = {}, error }) {
  const icon = status === "passed" ? "✔" : status === "skipped" ? "⊘" : "✗";
  const parts = [`${icon} ${formatStepRef({ index, title, meta })}`];
  if (status === "failed" && error) parts.push(String(error));
  else if (durationMs != null) parts.push(formatDuration(durationMs));
  const line = parts.join(" | ");
  if (status === "failed") logWarn(line);
  else logInfo(line);
}

function logMilestone(tag, msg) {
  logInfo(`[${tag}] ${msg}`);
}

function buildShopStepMeta({
  shopName,
  kind,
  shopIndex,
  shopTotal,
  daysToExport,
  dataDate,
  offset,
  extra
}) {
  return {
    phase: "shop",
    shopName,
    kind,
    shopIndex,
    shopTotal,
    daysToExport,
    dataDate,
    offset,
    ...(extra && typeof extra === "object" ? extra : {})
  };
}

module.exports = {
  logInfo,
  logWarn,
  logError,
  logStepResult,
  logMilestone,
  formatDuration,
  formatStepRef,
  buildShopStepMeta
};
