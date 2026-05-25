const path = require("path");
const fse = require("fs-extra");

const SHOP_EXPORT_DEBUG_DIR = path.resolve(
  process.env.SHOP_EXPORT_DEBUG_DIR ||
    path.join(process.cwd(), "storage/shop-export-debug")
);

const SHOP_EXPORT_DEBUG_TZ =
  process.env.SHOP_EXPORT_DEBUG_TZ || "Asia/Shanghai";

function safePathPart(value) {
  return String(value || "unknown").replace(/[\\/:*?"<>|]/g, "_");
}

function getShopExportDebugTimeParts(date = new Date(), timeZone = SHOP_EXPORT_DEBUG_TZ) {
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

function formatShopExportDebugTimestamp(date = new Date()) {
  const parts = getShopExportDebugTimeParts(date);
  const offset =
    new Intl.DateTimeFormat("en-GB", {
      timeZone: parts.timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value || parts.timeZone;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${parts.ms} ${offset}`;
}

function createShopExportDebugRunId(date = new Date()) {
  const parts = getShopExportDebugTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}-${parts.ms}`;
}

/** 每个邮箱账号固定一层目录，不再嵌套 taskId/runId。 */
function getShopExportDebugAccountDir(accountName) {
  const safeAccount = safePathPart(accountName || "unknown");
  return path.join(SHOP_EXPORT_DEBUG_DIR, safeAccount);
}

function getShopExportDebugTaskDir(accountName) {
  return getShopExportDebugAccountDir(accountName);
}

function getShopExportDebugSessionDir(accountName) {
  return getShopExportDebugAccountDir(accountName);
}

function readLatestShopExportStepState(accountName) {
  const statePath = path.join(
    getShopExportDebugAccountDir(accountName),
    "shop-export-step-state.json"
  );
  if (!fse.existsSync(statePath)) return null;
  try {
    const parsed = JSON.parse(fse.readFileSync(statePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.accountName && parsed.accountName !== accountName) return null;
    return { ...parsed, filePath: statePath };
  } catch {
    return null;
  }
}

function resolveShopExportDebugArtifactDir(accountName, options = {}) {
  if (options.runDir) return options.runDir;
  return getShopExportDebugAccountDir(accountName);
}

function getAriaSnapshotOptions() {
  const opts = {};
  const depth = process.env.SHOP_EXPORT_DEBUG_SNAPSHOT_DEPTH;
  if (depth) {
    const parsed = Number(depth);
    if (Number.isFinite(parsed) && parsed > 0) opts.depth = parsed;
  }
  return opts;
}

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

async function saveRunFailedArtifacts(page, accountName, options = {}) {
  if (!page || hasStepDebugSaved(options)) return;
  await saveDebugArtifacts(page, accountName, "run-failed", options);
}

async function saveDebugArtifacts(page, accountName, tag, options = {}) {
  const dir = resolveShopExportDebugArtifactDir(accountName, options);
  await fse.ensureDir(dir);

  const ymlPath = path.join(dir, `${tag}.yml`);
  const screenshotPath = path.join(dir, `${tag}.png`);
  const saveHtml = process.env.SHOP_EXPORT_DEBUG_SAVE_HTML === "true";

  try {
    const yaml = await capturePageAriaSnapshot(page);
    fse.writeFileSync(ymlPath, yaml, "utf-8");
  } catch {}

  if (saveHtml) {
    const htmlPath = path.join(dir, `${tag}.html`);
    try {
      const html = await page.content();
      fse.writeFileSync(htmlPath, html, "utf-8");
    } catch {}
  }

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch {}

  return { screenshotPath, ymlPath };
}

module.exports = {
  SHOP_EXPORT_DEBUG_DIR,
  SHOP_EXPORT_DEBUG_TZ,
  createShopExportDebugRunId,
  formatShopExportDebugTimestamp,
  getShopExportDebugAccountDir,
  getShopExportDebugTaskDir,
  getShopExportDebugSessionDir,
  readLatestShopExportStepState,
  markStepDebugSaved,
  saveRunFailedArtifacts,
  saveDebugArtifacts,
};
