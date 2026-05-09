const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_TASK_LOGS_DIR = "storage/task-logs";

const PREFIX_MAP = {
  "creator-publish-": "creator-publish",
  "creator-feishu-sync-": "creator-feishu-sync",
  "creator-export-push-": "creator-export-push",
  "creator-login-": "creator-login",
  "creator-open-": "creator-open",
  "creator-export-": "creator-export",
  "creator-": "creator-export",
  "shop-feishu-sync-": "shop-feishu-sync",
  "shop-export-push-": "shop-export-push",
  "shop-login-": "shop-login",
  "shop-export-": "shop-export",
  "shop-": "shop-export",
  "feishu-": "feishu",
};

function getTaskLogsDir() {
  return path.resolve(process.cwd(), process.env.TASK_LOGS_DIR || DEFAULT_TASK_LOGS_DIR);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function hashText(text) {
  return crypto.createHash("sha1").update(String(text || "")).digest("hex").slice(0, 10);
}

function safeTaskFileName(taskId) {
  const raw = String(taskId || "").trim();
  if (!raw) return `task-${hashText("task")}`;

  const asciiSlug = raw
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 150);

  const suffix = hashText(raw);
  return asciiSlug ? `${asciiSlug}-${suffix}`.slice(0, 180) : `task-${suffix}`;
}

function getTaskLogPath(taskId, date = new Date().toISOString().slice(0, 10)) {
  return path.join(getTaskLogsDir(), date, `${safeTaskFileName(taskId)}.log`);
}

function normalizeLevel(level) {
  const raw = String(level || "info").toLowerCase();
  if (raw === "error") return "error";
  if (raw === "warn") return "warn";
  return "info";
}

function normalizeLogEntry(levelOrEntry, text) {
  if (levelOrEntry && typeof levelOrEntry === "object") {
    return {
      level: normalizeLevel(levelOrEntry.level),
      text: String(levelOrEntry.text || ""),
      timestamp: levelOrEntry.timestamp || new Date().toISOString(),
    };
  }
  return {
    level: normalizeLevel(levelOrEntry),
    text: String(text || ""),
    timestamp: new Date().toISOString(),
  };
}

function normalizeTaskMeta(taskId, meta) {
  const normalized = { taskId: String(taskId || "").trim() };
  if (meta && typeof meta === "object") {
    for (const [key, value] of Object.entries(meta)) {
      if (value === undefined || value === null) continue;
      const text = String(value).trim();
      if (!text) continue;
      normalized[key] = text;
    }
  }
  return normalized;
}

function formatMetaLine(taskId, meta) {
  return `#META ${JSON.stringify(normalizeTaskMeta(taskId, meta))}\n`;
}

function parseMetaLine(rawLine) {
  const trimmed = String(rawLine || "").trim();
  if (!trimmed.startsWith("#META ")) return null;
  try {
    const meta = JSON.parse(trimmed.slice(6));
    if (!meta || typeof meta !== "object") return null;
    return meta;
  } catch {
    return null;
  }
}

function ensureTaskLogMeta(taskId, meta, timestamp = new Date().toISOString()) {
  try {
    const filePath = getTaskLogPath(taskId, timestamp.slice(0, 10));
    ensureDir(path.dirname(filePath));
    let current = "";
    try {
      current = fs.readFileSync(filePath, "utf-8");
    } catch {
      // Create the file below.
    }
    const firstLine = current.split("\n", 1)[0] || "";
    if (parseMetaLine(firstLine)) return;
    const nextContent = formatMetaLine(taskId, meta) + current;
    fs.writeFileSync(filePath, nextContent, "utf-8");
  } catch {
    // Log metadata persistence must not break task execution.
  }
}

function appendTaskLog(taskId, levelOrEntry, text) {
  try {
    const entry = normalizeLogEntry(levelOrEntry, text);
    const filePath = getTaskLogPath(taskId, entry.timestamp.slice(0, 10));
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(
      filePath,
      `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.text}\n`,
      "utf-8"
    );
  } catch {
    // Log persistence must not break task execution.
  }
}

function appendTaskDone(taskId, code, summary) {
  appendTaskLog(taskId, {
    level: "info",
    text: `DONE code=${code ?? -1} summary=${summary || `Process exited with code ${code ?? -1}`}`,
    timestamp: new Date().toISOString(),
  });
}

function parseLogLine(rawLine) {
  const trimmed = String(rawLine || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#META ")) return null;
  const match = trimmed.match(/^\[([^\]]+)\]\s*\[([A-Z]+)\]\s*(.*)$/);
  if (!match) {
    return {
      text: trimmed,
      level: "info",
      timestamp: new Date().toISOString(),
    };
  }
  return {
    text: match[3],
    level: normalizeLevel(match[2]),
    timestamp: match[1],
  };
}

function parseDone(content) {
  const match = String(content || "").match(/DONE code=(-?\d+)\s+summary=(.+)/);
  if (!match) return null;
  return {
    code: parseInt(match[1], 10),
    summary: match[2] || "",
  };
}

function candidateDates(taskId) {
  const dates = [new Date().toISOString().slice(0, 10)];
  const match = String(taskId || "").match(/^(?:creator-|shop-|feishu-|)(?:publish-|export-|login-|sync-|backup-)(\d{4}-\d{2}-\d{2})/);
  if (match && !dates.includes(match[1])) dates.unshift(match[1]);
  return dates;
}

function readTaskLogContent(taskId) {
  for (const date of candidateDates(taskId)) {
    const filePath = getTaskLogPath(taskId, date);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      if (content.trim()) {
        const firstLine = content.split("\n", 1)[0] || "";
        return {
          content,
          date,
          filePath,
          meta: parseMetaLine(firstLine),
        };
      }
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function loadTaskLogEvents(taskId) {
  const row = readTaskLogContent(taskId);
  if (!row) return null;
  const events = [];
  for (const line of row.content.split("\n")) {
    const entry = parseLogLine(line);
    if (!entry) continue;
    events.push({ event: "log", data: JSON.stringify(entry) });
  }
  const done = parseDone(row.content);
  if (done) {
    events.push({ event: "done", data: JSON.stringify({ code: done.code, summary: done.summary }) });
  }
  return events.length > 0 ? events : null;
}

function loadTaskSnapshot(taskId) {
  const events = loadTaskLogEvents(taskId);
  if (!events) return { found: false, logs: [], done: false, exitCode: null, summary: "" };

  const logs = [];
  let done = false;
  let exitCode = null;
  let summary = "";
  for (const event of events) {
    if (event.event === "log") {
      try {
        logs.push(JSON.parse(event.data));
      } catch {
        // Skip malformed log event.
      }
    } else if (event.event === "done") {
      try {
        const data = JSON.parse(event.data);
        done = true;
        exitCode = data.code;
        summary = data.summary || "";
      } catch {
        // Skip malformed done event.
      }
    }
  }
  return { found: true, logs, done, exitCode, summary };
}

function parseNamespace(taskId) {
  let bestNs = "";
  let bestLen = 0;
  for (const [prefix, namespace] of Object.entries(PREFIX_MAP)) {
    if (String(taskId || "").startsWith(prefix) && prefix.length > bestLen) {
      bestLen = prefix.length;
      bestNs = namespace;
    }
  }
  return bestNs || "system";
}

function listRecentTaskLogs(limit = 10) {
  const resultsByKey = new Map();
  const now = new Date();
  const dates = new Set();
  for (let i = 0; i < 4; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    dates.add(date.toISOString().slice(0, 10));
  }

  for (const date of dates) {
    const dir = path.join(getTaskLogsDir(), date);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".log")) continue;
      const taskId = entry.name.slice(0, -4);
      const filePath = path.join(dir, entry.name);
      let stat;
      let content;
      try {
        stat = fs.statSync(filePath);
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      let firstLine = "";
      const meta = parseMetaLine(content.split("\n", 1)[0] || "");
      for (const line of content.split("\n")) {
        const parsed = parseLogLine(line);
        if (!parsed) continue;
        firstLine = parsed.text.slice(0, 80);
        break;
      }
      const done = parseDone(content);
      const realTaskId = String(meta?.taskId || taskId);
      const row = {
        taskId: realTaskId,
        date,
        firstLine,
        hasDone: Boolean(done),
        exitCode: done ? done.code : null,
        namespace: String(meta?.namespace || parseNamespace(taskId)),
        mtime: stat.mtimeMs,
      };
      const key = `${date}:${realTaskId}`;
      const prev = resultsByKey.get(key);
      if (
        !prev ||
        row.mtime > prev.mtime ||
        (!prev.hasDone && row.hasDone) ||
        (!prev.firstLine && row.firstLine)
      ) {
        resultsByKey.set(key, row);
      }
    }
  }

  const results = Array.from(resultsByKey.values());
  results.sort((a, b) => b.mtime - a.mtime);
  return results.slice(0, limit);
}

function readLastTaskError(taskId) {
  const row = readTaskLogContent(taskId);
  if (!row) return undefined;
  const lines = row.content.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/\[ERROR\] (.*)/);
    if (!match) continue;
    const text = match[1].trim();
    if (/^\s*at\s/.test(text)) continue;
    return text;
  }
  return undefined;
}

module.exports = {
  appendTaskDone,
  appendTaskLog,
  ensureTaskLogMeta,
  getTaskLogPath,
  getTaskLogsDir,
  listRecentTaskLogs,
  loadTaskLogEvents,
  loadTaskSnapshot,
  parseNamespace,
  readLastTaskError,
  safeTaskFileName,
};
