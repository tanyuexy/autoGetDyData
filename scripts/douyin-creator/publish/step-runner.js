const path = require("path");
const fs = require("fs/promises");
const { ensureDir } = require("../../common/fs");
const {
  createPublishDebugRunId,
  formatPublishDebugTimestamp,
  getPublishDebugTaskDir,
  getPublishDebugSessionDir,
  markStepDebugSaved,
  saveDebugArtifacts,
} = require("./debug");
const { stage, done } = require("./logger");

const DEFAULT_STEP_TIMEOUT_MS = Number(process.env.CREATOR_PUBLISH_STEP_TIMEOUT_MS || 8 * 60 * 1000);
const STEP_HEARTBEAT_MS = Number(process.env.CREATOR_PUBLISH_STEP_HEARTBEAT_MS || 15 * 1000);

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
    process.env.CREATOR_PUBLISH_DEBUG_STEPS === "true"
  );
}

function createStepStateStore({ accountName, flow, taskId }) {
  const runId = createPublishDebugRunId();
  const taskDir = getPublishDebugTaskDir(accountName, { task: taskId });
  const sessionDir = getPublishDebugSessionDir(accountName, { task: taskId, runId });
  const latestPath = path.join(taskDir, "latest-publish-step-state.json");
  const sessionStatePath = path.join(sessionDir, "publish-step-state.json");
  const historyPath = path.join(sessionDir, `${safeName(flow)}-steps.jsonl`);

  async function write(record) {
    await ensureDir(taskDir);
    await ensureDir(sessionDir);
    const payload = {
      runId,
      flow,
      accountName,
      timestamp: formatPublishDebugTimestamp(),
      ...record,
    };
    const line = `${JSON.stringify(payload)}\n`;
    const serialized = JSON.stringify(payload, null, 2);
    const writes = [
      fs.writeFile(latestPath, serialized, "utf8"),
      fs.writeFile(sessionStatePath, serialized, "utf8"),
      fs.appendFile(historyPath, line, "utf8"),
    ];
    await Promise.all(writes);
    console.log(`[publish-step] ${JSON.stringify(payload)}`);
  }

  return { write, latestPath, sessionStatePath, historyPath, runId, taskDir, sessionDir };
}

async function closePageForTimeout(page) {
  if (!page) return;
  await page.context?.().close?.().catch(() => {});
  await page.close?.().catch(() => {});
}

async function readPageSnapshot(page) {
  if (!page) return {};
  const url = page.url?.() || "";
  const pageTitle = await page.title().catch(() => "");
  return { url, pageTitle };
}

function createPublishStepRunner({
  page,
  accountName,
  flow,
  options = {},
  saveStepDebug,
}) {
  const store = createStepStateStore({ accountName, flow, taskId: options.task });
  const debugOptions = {
    ...options,
    runId: store.runId,
    runDir: store.sessionDir,
  };

  async function runStep(index, title, tag, action, verifyOrOptions, maybeOptions) {
    let verify = verifyOrOptions;
    let stepOptions = maybeOptions || {};
    if (verifyOrOptions && typeof verifyOrOptions === "object") {
      verify = verifyOrOptions.verify;
      stepOptions = verifyOrOptions;
    }
    const timeoutMs = Number(stepOptions.timeoutMs || options.stepTimeoutMs || DEFAULT_STEP_TIMEOUT_MS);

    stage(index, title);
    const startedAt = Date.now();
    const base = { index, title, tag, ...(await readPageSnapshot(page)) };

    if (stepOptions.skipped) {
      await store.write({
        ...base,
        status: "skipped",
        reason: stepOptions.skipReason || title,
        durationMs: 0,
      });
      done(index);
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
        durationMs: Date.now() - startedAt,
      });

      let settled = false;
      const heartbeat = setInterval(() => {
        if (settled) return;
        store.write({
          ...base,
          status: "running",
          phase,
          timeoutMs,
          durationMs: Date.now() - startedAt,
          phaseDurationMs: Date.now() - phaseStartedAt,
          heartbeat: true,
        }).catch(() => {});
      }, Math.max(1000, STEP_HEARTBEAT_MS));
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
                    const timeoutError = new Error(`步骤 ${phase} 超时 ${formatTimeoutSeconds(timeoutMs)} 秒`);
                    timeoutError.stepTimeout = true;
                    await store.write({
                      ...base,
                      ...(await readPageSnapshot(page)),
                      status: "failed",
                      phase,
                      error: timeoutError.message,
                      timeoutMs,
                      durationMs: Date.now() - startedAt,
                      phaseDurationMs: Date.now() - phaseStartedAt,
                    }).catch(() => {});
                    const timeoutTag = `${safeName(flow)}-step-${tag}-${phase}-timeout`;
                    await saveDebugArtifacts(page, accountName, timeoutTag, debugOptions).catch(() => {});
                    markStepDebugSaved(debugOptions, timeoutTag);
                    await closePageForTimeout(page);
                    reject(timeoutError);
                  }, timeoutMs);
                  timeout.unref?.();
                }),
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
        await saveDebugArtifacts(page, accountName, `${safeName(flow)}-step-${tag}`, debugOptions).catch(() => {});
      }
      await store.write({
        ...base,
        ...(await readPageSnapshot(page)),
        status: "passed",
        phase: "done",
        timeoutMs,
        durationMs: Date.now() - startedAt,
      });
      done(index);
    } catch (error) {
      const message = error?.message || String(error);
      await store.write({
        ...base,
        ...(await readPageSnapshot(page)),
        status: "failed",
        phase: "failed",
        error: message,
        timeoutMs,
        durationMs: Date.now() - startedAt,
      }).catch(() => {});
      if (!error?.stepTimeout) {
        const failedTag = `${safeName(flow)}-step-${tag}-failed`;
        await saveDebugArtifacts(page, accountName, failedTag, debugOptions).catch(() => {});
        markStepDebugSaved(debugOptions, failedTag);
      }
      const wrapped = new Error(`阶段 ${index}「${title}」失败：${message}`);
      wrapped.cause = error;
      throw wrapped;
    }
  }

  return { runStep, debugOptions };
}

module.exports = {
  createPublishStepRunner,
  shouldSaveStepDebug,
};
