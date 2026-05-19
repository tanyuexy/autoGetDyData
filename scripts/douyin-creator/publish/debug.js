const path = require("path");
const fs = require("fs");
const { ensureDir } = require("../../common/fs");

const PUBLISH_DEBUG_DIR = path.resolve(
  process.env.CREATOR_PUBLISH_DEBUG_DIR ||
    path.join(process.cwd(), "storage/creator-publish-debug")
);

function safePathPart(value) {
  return String(value || "unknown").replace(/[\\/:*?"<>|]/g, "_");
}

const PUBLISH_DEBUG_TZ = process.env.CREATOR_PUBLISH_DEBUG_TZ || "Asia/Shanghai";

function getPublishDebugTimeParts(date = new Date(), timeZone = PUBLISH_DEBUG_TZ) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    fractionalSecondDigits: 3,
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
    ms: map.fractionalSecond || "000",
    timeZone,
  };
}

/** 日志 / JSON：`2026-05-19 13:03:52.813 GMT+8` */
function formatPublishDebugTimestamp(date = new Date()) {
  const parts = getPublishDebugTimeParts(date);
  const offset =
    new Intl.DateTimeFormat("en-GB", {
      timeZone: parts.timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value || parts.timeZone;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${parts.ms} ${offset}`;
}

/** 目录名：`2026-05-19_13-03-52-813` */
function createPublishDebugRunId(date = new Date()) {
  const parts = getPublishDebugTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}-${parts.ms}`;
}

function getPublishDebugTaskDir(accountName, options = {}) {
  const safeAccount = safePathPart(accountName || "unknown");
  const taskId = String(options.task || options.taskId || "").trim();
  const safeTask = taskId ? safePathPart(taskId) : "_manual";
  return path.join(PUBLISH_DEBUG_DIR, safeAccount, safeTask);
}

function getPublishDebugSessionDir(accountName, options = {}) {
  const runId = String(options.runId || "").trim();
  if (!runId) {
    throw new Error("getPublishDebugSessionDir 需要 options.runId");
  }
  return path.join(getPublishDebugTaskDir(accountName, options), runId);
}

const PUBLISH_DEBUG_RUN_ID_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/;

function isPublishDebugRunId(name) {
  return PUBLISH_DEBUG_RUN_ID_RE.test(String(name || ""));
}

/** 任务目录下最近一次运行的 publish-step-state.json（按 runId 字典序取最新） */
function readLatestPublishStepStateFromTaskDir(taskDir, { accountName } = {}) {
  if (!taskDir || !fs.existsSync(taskDir)) return null;

  let latestRunId = "";
  let latestStatePath = "";

  for (const name of fs.readdirSync(taskDir)) {
    if (!isPublishDebugRunId(name) || name <= latestRunId) continue;
    const statePath = path.join(taskDir, name, "publish-step-state.json");
    try {
      if (!fs.statSync(statePath).isFile()) continue;
    } catch {
      continue;
    }
    latestRunId = name;
    latestStatePath = statePath;
  }

  if (!latestStatePath) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(latestStatePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (accountName && parsed.accountName && parsed.accountName !== accountName) return null;
    return { ...parsed, filePath: latestStatePath };
  } catch {
    return null;
  }
}

function resolvePublishDebugArtifactDir(accountName, options = {}) {
  if (options.runDir) return options.runDir;
  if (options.runId) return getPublishDebugSessionDir(accountName, options);
  return getPublishDebugTaskDir(accountName, options);
}

function getAriaSnapshotOptions() {
  const opts = {};
  const depth = process.env.CREATOR_PUBLISH_DEBUG_SNAPSHOT_DEPTH;
  if (depth) {
    const parsed = Number(depth);
    if (Number.isFinite(parsed) && parsed > 0) opts.depth = parsed;
  }
  return opts;
}

/**
 * 生成与 playwright-cli snapshot 相同风格的 YAML 可访问性树，便于人工排查 DOM。
 */
async function capturePageAriaSnapshot(page) {
  const url = page?.url?.() || "";
  const title = await page.title().catch(() => "");
  const snapshotOpts = getAriaSnapshotOptions();
  let tree = "";
  try {
    if (typeof page.ariaSnapshot === "function") {
      tree = await page.ariaSnapshot(snapshotOpts);
    } else {
      tree = await page.locator("body").ariaSnapshot(snapshotOpts);
    }
  } catch (error) {
    tree = `# aria snapshot failed: ${error?.message || String(error)}`;
  }

  return [
    "### Page",
    `- Page URL: ${url}`,
    `- Page Title: ${title}`,
    "### Snapshot",
    String(tree || "").trimEnd(),
    "",
  ].join("\n");
}

function markStepDebugSaved(options, artifactTag) {
  if (!options || typeof options !== "object") return;
  options.stepDebugSaved = artifactTag || true;
}

function hasStepDebugSaved(options) {
  return Boolean(options?.stepDebugSaved);
}

/** 步骤内已存失败快照时跳过，避免与 *-step-*-failed 重复 */
async function saveRunFailedArtifacts(page, accountName, options = {}) {
  if (!page || hasStepDebugSaved(options)) return;
  await saveDebugArtifacts(page, accountName, "run-failed", options);
}

async function saveDebugArtifacts(page, accountName, tag, options = {}) {
  const dir = resolvePublishDebugArtifactDir(accountName, options);
  await ensureDir(dir);

  const ymlPath = path.join(dir, `${tag}.yml`);
  const screenshotPath = path.join(dir, `${tag}.png`);
  const saveHtml = process.env.CREATOR_PUBLISH_DEBUG_SAVE_HTML === "true";

  try {
    const yaml = await capturePageAriaSnapshot(page);
    fs.writeFileSync(ymlPath, yaml, "utf-8");
    console.log(`已保存页面结构: ${ymlPath}`);
  } catch {}

  if (saveHtml) {
    const htmlPath = path.join(dir, `${tag}.html`);
    try {
      const html = await page.content();
      fs.writeFileSync(htmlPath, html, "utf-8");
      console.log(`已保存调试 HTML: ${htmlPath}`);
    } catch {}
  }

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`已保存调试截图: ${screenshotPath}`);
  } catch {}
}

module.exports = {
  PUBLISH_DEBUG_DIR,
  PUBLISH_DEBUG_TZ,
  formatPublishDebugTimestamp,
  createPublishDebugRunId,
  getPublishDebugTaskDir,
  getPublishDebugSessionDir,
  isPublishDebugRunId,
  readLatestPublishStepStateFromTaskDir,
  markStepDebugSaved,
  saveRunFailedArtifacts,
  saveDebugArtifacts,
};
