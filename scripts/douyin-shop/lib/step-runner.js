const path = require("path");
const fse = require("fs-extra");
const {
  createShopExportDebugRunId,
  formatShopExportDebugTimestamp,
  getShopExportDebugAccountDir,
  markStepDebugSaved,
  saveDebugArtifacts
} = require("./debug");
const { logStepResult } = require("./shop-log");

const DEFAULT_STEP_TIMEOUT_MS = Number(
  process.env.SHOP_EXPORT_STEP_TIMEOUT_MS || 8 * 60 * 1000
);
const STEP_HEARTBEAT_MS = Number(
  process.env.SHOP_EXPORT_STEP_HEARTBEAT_MS || 15 * 1000
);

function safeName(value) {
  return String(value || "unknown").replace(/[\\/:*?"<>|]/g, "_");
}

function formatTimeoutSeconds(ms) {
  return Math.max(1, Math.ceil(Number(ms || 0) / 1000));
}

function shouldSaveStepDebug(options) {
  return (
    options?.debugSteps === true ||
    options?.debugSteps === "true" ||
    process.env.SHOP_EXPORT_DEBUG_STEPS === "true"
  );
}

function createStepStateStore({ accountName, flow, taskId, exportBatchId }) {
  const runId = createShopExportDebugRunId();
  const accountDir = getShopExportDebugAccountDir(accountName);
  const sessionStatePath = path.join(accountDir, "shop-export-step-state.json");
  const historyPath = path.join(accountDir, `${safeName(flow)}-steps.jsonl`);

  fse.ensureDirSync(accountDir);
  fse.writeFileSync(historyPath, "", "utf8");

  async function write(record) {
    await fse.ensureDir(accountDir);
    const payload = {
      runId,
      flow,
      accountName,
      taskId: taskId || exportBatchId || null,
      timestamp: formatShopExportDebugTimestamp(),
      ...record
    };
    const line = `${JSON.stringify(payload)}\n`;
    const serialized = JSON.stringify(payload, null, 2);
    await Promise.all([
      fse.writeFile(sessionStatePath, serialized, "utf8"),
      fse.appendFile(historyPath, line, "utf8")
    ]);
  }

  return { write, sessionStatePath, historyPath, runId, accountDir };
}

async function closePageForTimeout(page) {
  if (!page) return;
  await page
    .context?.()
    .close?.()
    .catch(() => {});
  await page.close?.().catch(() => {});
}

async function readPageSnapshot(page) {
  if (!page) return {};
  const url = page.url?.() || "";
  const pageTitle = await page.title().catch(() => "");
  return { url, pageTitle };
}

function resolveTaskId(options = {}) {
  return (
    options.task ||
    options.taskId ||
    process.env.SHOP_TASK_ID ||
    process.env.TASK_JOB_ID ||
    ""
  );
}

function createShopExportStepRunner({
  page,
  accountName,
  flow,
  options = {},
  saveStepDebug
}) {
  const store = createStepStateStore({
    accountName,
    flow,
    taskId: resolveTaskId(options),
    exportBatchId: options.exportBatchId
  });
  const debugOptions = {
    ...options,
    task: resolveTaskId(options),
    runId: store.runId,
    runDir: store.accountDir
  };

  async function runStep(
    index,
    title,
    tag,
    action,
    verifyOrOptions,
    maybeOptions
  ) {
    let verify = verifyOrOptions;
    let stepOptions = maybeOptions || {};
    if (verifyOrOptions && typeof verifyOrOptions === "object") {
      verify = verifyOrOptions.verify;
      stepOptions = verifyOrOptions;
    }
    const timeoutMs = Number(
      stepOptions.timeoutMs || options.stepTimeoutMs || DEFAULT_STEP_TIMEOUT_MS
    );
    const meta =
      stepOptions.meta && typeof stepOptions.meta === "object"
        ? stepOptions.meta
        : {};

    const startedAt = Date.now();
    const base = { index, title, tag, ...meta, ...(await readPageSnapshot(page)) };

    if (stepOptions.skipped) {
      await store.write({
        ...base,
        status: "skipped",
        reason: stepOptions.skipReason || title,
        durationMs: 0
      });
      logStepResult({
        index,
        title,
        status: "skipped",
        durationMs: 0,
        meta
      });
      return;
    }

    async function runPhase(phase, fn) {
      if (typeof fn !== "function") return;
      const phaseStartedAt = Date.now();
      await store.write({
        ...base,
        ...(await readPageSnapshot(page)),
        status: "running",
        phase,
        timeoutMs,
        durationMs: Date.now() - startedAt
      });

      let settled = false;
      const heartbeat = setInterval(
        () => {
          if (settled) return;
          store
            .write({
              ...base,
              status: "running",
              phase,
              timeoutMs,
              durationMs: Date.now() - startedAt,
              phaseDurationMs: Date.now() - phaseStartedAt,
              heartbeat: true
            })
            .catch(() => {});
        },
        Math.max(1000, STEP_HEARTBEAT_MS)
      );
      heartbeat.unref?.();

      let timeout = null;
      try {
        const work = Promise.resolve().then(fn);
        const guarded =
          timeoutMs > 0
            ? Promise.race([
                work,
                new Promise((_, reject) => {
                  timeout = setTimeout(async () => {
                    const timeoutError = new Error(
                      `步骤 ${phase} 超时 ${formatTimeoutSeconds(timeoutMs)} 秒`
                    );
                    timeoutError.stepTimeout = true;
                    await store
                      .write({
                        ...base,
                        ...(await readPageSnapshot(page)),
                        status: "failed",
                        phase,
                        error: timeoutError.message,
                        timeoutMs,
                        durationMs: Date.now() - startedAt,
                        phaseDurationMs: Date.now() - phaseStartedAt
                      })
                      .catch(() => {});
                    const timeoutTag = `${safeName(flow)}-step-${tag}-${phase}-timeout`;
                    await saveDebugArtifacts(
                      page,
                      accountName,
                      timeoutTag,
                      debugOptions
                    ).catch(() => {});
                    markStepDebugSaved(debugOptions, timeoutTag);
                    await closePageForTimeout(page);
                    reject(timeoutError);
                  }, timeoutMs);
                  timeout.unref?.();
                })
              ])
            : work;
        await guarded;
      } finally {
        settled = true;
        clearInterval(heartbeat);
        if (timeout) clearTimeout(timeout);
      }
    }

    try {
      await runPhase("action", action);
      await runPhase("verify", verify);
      if (typeof saveStepDebug === "function") {
        await saveStepDebug(page, accountName, tag, debugOptions);
      } else if (shouldSaveStepDebug(options)) {
        await saveDebugArtifacts(
          page,
          accountName,
          `${safeName(flow)}-step-${tag}`,
          debugOptions
        ).catch(() => {});
      }
      const durationMs = Date.now() - startedAt;
      await store.write({
        ...base,
        ...(await readPageSnapshot(page)),
        status: "passed",
        phase: "done",
        timeoutMs,
        durationMs
      });
      logStepResult({ index, title, status: "passed", durationMs, meta });
    } catch (error) {
      const message = error?.message || String(error);
      const durationMs = Date.now() - startedAt;
      await store
        .write({
          ...base,
          ...(await readPageSnapshot(page)),
          status: "failed",
          phase: "failed",
          error: message,
          timeoutMs,
          durationMs
        })
        .catch(() => {});
      if (!error?.stepTimeout) {
        const failedTag = `${safeName(flow)}-step-${tag}-failed`;
        await saveDebugArtifacts(
          page,
          accountName,
          failedTag,
          debugOptions
        ).catch(() => {});
        markStepDebugSaved(debugOptions, failedTag);
      }
      logStepResult({
        index,
        title,
        status: "failed",
        durationMs,
        meta,
        error: message.split("\n")[0]
      });
      const wrapped = new Error(
        `阶段 ${index}「${title}」失败：${message.split("\n")[0]}`
      );
      wrapped.cause = error;
      throw wrapped;
    }
  }

  return { runStep, debugOptions, store };
}

module.exports = {
  createShopExportStepRunner,
  shouldSaveStepDebug
};
