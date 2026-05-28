function getInternalApiBaseUrl() {
  return String(
    process.env.INTERNAL_API_BASE_URL ||
      process.env.APP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://127.0.0.1:3000"
  ).replace(/\/+$/, "");
}

function getInternalApiToken() {
  return String(process.env.INTERNAL_API_TOKEN || process.env.APP_AUTH_SECRET || "").trim();
}

async function postInternalApi(path, body) {
  const url = `${getInternalApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const internalApiToken = getInternalApiToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(internalApiToken ? { "X-Internal-Api-Token": internalApiToken } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(data.error || data.raw || `HTTP ${response.status}`);
  }
  return data;
}

async function waitForTaskDone(taskId, options = {}) {
  const baseUrl = getInternalApiBaseUrl();
  const internalApiToken = getInternalApiToken();
  const timeoutMs = Number(options.timeoutMs || 30 * 60 * 1000);
  const startedAt = Date.now();
  let printedLogs = 0;

  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`等待 API 任务超时: ${taskId}`);
    }
    const response = await fetch(
      `${baseUrl}/api/progress/${encodeURIComponent(taskId)}/snapshot`,
      {
        cache: "no-store",
        headers: {
          ...(internalApiToken ? { "X-Internal-Api-Token": internalApiToken } : {}),
        },
      }
    );
    const data = await response.json().catch(() => ({}));
    const logs = Array.isArray(data.logs) ? data.logs : [];
    for (const entry of logs.slice(printedLogs)) {
      const text = String(entry && entry.text ? entry.text : "").trim();
      if (text && !/^DONE code=/.test(text)) console.log(`[api:${taskId}] ${text}`);
    }
    printedLogs = logs.length;
    if (data && data.done) {
      if (Number(data.exitCode) !== 0) {
        throw new Error(data.summary || `API 任务失败: ${taskId}`);
      }
      return data;
    }
    await new Promise((resolve) => setTimeout(resolve, Number(options.intervalMs || 1000)));
  }
}

async function startAndWaitInternalApiTask(path, body, options = {}) {
  const data = await postInternalApi(path, body);
  if (!data.taskId) return data;
  return await waitForTaskDone(data.taskId, options);
}

module.exports = {
  getInternalApiBaseUrl,
  getInternalApiToken,
  postInternalApi,
  startAndWaitInternalApiTask,
  waitForTaskDone,
};
