import type { LogEntry } from "@/types";
import fs from "fs";
import path from "path";

type SSEClient = {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
};

type BufferedEvent = { event: string; data: string };

const clients = new Map<string, SSEClient>();
const eventBuffer = new Map<string, BufferedEvent[]>();
const MAX_BUFFER_SIZE = 1000;

/** Wire-format chunks waiting for ReadableStream backpressure to clear */
const pendingSseChunks = new Map<string, string[]>();

const TASK_LOGS_DIR = process.env.TASK_LOGS_DIR || "storage/task-logs";

function appendPendingChunk(taskId: string, sseChunk: string) {
  let q = pendingSseChunks.get(taskId);
  if (!q) {
    q = [];
    pendingSseChunks.set(taskId, q);
  }
  q.push(sseChunk);
}

function clearPending(taskId: string) {
  pendingSseChunks.delete(taskId);
}

/**
 * Deliver one SSE message to the browser, or queue it if the stream is backpressured.
 * Avoids dropping the client when enqueue() throws (common during large replays).
 */
function writeSseChunk(taskId: string, sseChunk: string) {
  const client = clients.get(taskId);
  if (!client) return;
  const { controller, encoder } = client;
  try {
    const ds = controller.desiredSize;
    if (ds !== null && ds <= 0) {
      appendPendingChunk(taskId, sseChunk);
      return;
    }
    controller.enqueue(encoder.encode(sseChunk));
  } catch {
    try {
      clients.delete(taskId);
    } catch {
      /* ignore */
    }
  }
}

/** Called from ReadableStream `pull` to flush queued SSE data */
export function drainSsePending(taskId: string) {
  const client = clients.get(taskId);
  if (!client) return;
  const q = pendingSseChunks.get(taskId);
  if (!q?.length) return;
  const { controller, encoder } = client;
  while (q.length > 0) {
    const chunk = q[0];
    try {
      const ds = controller.desiredSize;
      if (ds !== null && ds <= 0) return;
      controller.enqueue(encoder.encode(chunk));
      q.shift();
    } catch {
      clients.delete(taskId);
      return;
    }
  }
  pendingSseChunks.delete(taskId);
}

function tryLoadLogsFromDisk(taskId: string): BufferedEvent[] | null {
  try {
    const day = taskId.match(/^(?:creator-|shop-|feishu-|)(?:publish-|export-|login-|sync-|backup-)(\d{4}-\d{2}-\d{2})/);
    const dirs = [new Date().toISOString().slice(0, 10)];
    if (day) dirs.unshift(day[1]);

    for (const d of dirs) {
      const filePath = path.join(process.cwd(), TASK_LOGS_DIR, d, `${taskId.replace(/[^a-zA-Z0-9._-]/g, "_")}.log`);
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      if (!content.trim()) continue;

      const events: BufferedEvent[] = [];
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^\[([^\]]+)\]\s*\[([A-Z]+)\]\s*(.*)$/);
        if (match) {
          const level =
            match[2].toLowerCase() === "error"
              ? "error"
              : match[2].toLowerCase() === "warn"
                ? "warn"
                : "info";
          events.push({
            event: "log",
            data: JSON.stringify({ text: match[3], level, timestamp: match[1] }),
          });
        } else {
          events.push({
            event: "log",
            data: JSON.stringify({ text: trimmed, level: "info", timestamp: new Date().toISOString() }),
          });
        }
      }

      const doneMatch = content.match(/DONE code=(-?\d+)\s+summary=(.+)/);
      if (doneMatch) {
        events.push({
          event: "done",
          data: JSON.stringify({ code: parseInt(doneMatch[1], 10), summary: doneMatch[2] }),
        });
      }

      return events.length > 0 ? events : null;
    }
    return null;
  } catch {
    return null;
  }
}

export type TaskLogSnapshot = {
  found: boolean;
  logs: LogEntry[];
  done: boolean;
  exitCode: number | null;
  summary: string;
};

/** Read persisted task log (for UI reconcile when SSE missed events). */
export function loadTaskSnapshotFromDisk(taskId: string): TaskLogSnapshot {
  const raw = tryLoadLogsFromDisk(taskId);
  if (!raw) return { found: false, logs: [], done: false, exitCode: null, summary: "" };

  const logs: LogEntry[] = [];
  let done = false;
  let exitCode: number | null = null;
  let summary = "";

  for (const ev of raw) {
    if (ev.event === "log") {
      try {
        const row = JSON.parse(ev.data) as LogEntry;
        logs.push(row);
      } catch {
        /* skip */
      }
    } else if (ev.event === "done") {
      try {
        const d = JSON.parse(ev.data) as { code: number; summary: string };
        done = true;
        exitCode = d.code;
        summary = d.summary || "";
      } catch {
        /* skip */
      }
    }
  }

  return { found: true, logs, done, exitCode, summary };
}

export interface RecentTaskLogMeta {
  taskId: string;
  date: string;
  firstLine: string;
  hasDone: boolean;
  exitCode: number | null;
  namespace: string;
  mtime: number;
}

/** Scan disk log directories for recent task logs (last N). */
export function listRecentTaskLogs(limit: number = 10): RecentTaskLogMeta[] {
  const results: RecentTaskLogMeta[] = [];
  const now = new Date();

  // Collect log directories for today and the last 3 days
  const dirs = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dirs.add(d.toISOString().slice(0, 10));
  }

  for (const day of dirs) {
    const dayDir = path.join(process.cwd(), TASK_LOGS_DIR, day);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dayDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith(".log")) continue;
      const taskId = ent.name.slice(0, -4); // strip .log
      const filePath = path.join(dayDir, ent.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }

      // Parse first meaningful line and DONE marker
      let firstLine = "";
      let hasDone = false;
      let exitCode: number | null = null;
      let ns = parseNamespace(taskId);

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        // First non-empty line after the timestamp/level prefix
        for (const raw of lines) {
          const trimmed = raw.trim();
          if (!trimmed) continue;
          const m = trimmed.match(/^\[([^\]]+)\]\s*\[([A-Z]+)\]\s*(.*)$/);
          if (m) {
            firstLine = m[3].slice(0, 80);
            break;
          }
        }
        // Check for DONE marker
        const doneMatch = content.match(/DONE code=(-?\d+)\s+summary=(.+)/);
        if (doneMatch) {
          hasDone = true;
          exitCode = parseInt(doneMatch[1], 10);
        }
      } catch {
        /* skip */
      }

      results.push({
        taskId,
        date: day,
        firstLine,
        hasDone,
        exitCode,
        namespace: ns,
        mtime: stat.mtimeMs,
      });
    }
  }

  // Sort by mtime descending, take top N
  results.sort((a, b) => b.mtime - a.mtime);
  return results.slice(0, limit);
}

const PREFIX_MAP: Record<string, string> = {
  "creator-publish-": "creator-publish",
  "creator-feishu-sync-": "creator-feishu-sync",
  "creator-export-push-": "creator-export-push",
  "creator-login-": "creator-login",
  "creator-export-": "creator-export",
  "creator-": "creator-export",
  "shop-feishu-sync-": "shop-feishu-sync",
  "shop-export-push-": "shop-export-push",
  "shop-login-": "shop-login",
  "shop-export-": "shop-export",
  "shop-": "shop-export",
  "feishu-": "feishu",
};

function parseNamespace(taskId: string): string {
  let bestNs = "";
  let bestLen = 0;
  const entries = Object.entries(PREFIX_MAP);
  for (let i = 0; i < entries.length; i++) {
    const [prefix, ns] = entries[i];
    if (taskId.startsWith(prefix) && prefix.length > bestLen) {
      bestLen = prefix.length;
      bestNs = ns;
    }
  }
  return bestNs || "system";
}

// ---- Public API ----

export function createChannel(taskId: string): {
  send: (event: string, data: any) => void;
  close: () => void;
} {
  return {
    send(event: string, data: any) {
      const payload = JSON.stringify(data);
      const buffer = eventBuffer.get(taskId);
      if (buffer) {
        buffer.push({ event, data: payload });
        if (buffer.length > MAX_BUFFER_SIZE) buffer.shift();
      } else {
        eventBuffer.set(taskId, [{ event, data: payload }]);
      }

      const client = clients.get(taskId);
      if (!client) {
        return;
      }
      const msg = `event: ${event}\ndata: ${payload}\n\n`;
      writeSseChunk(taskId, msg);
    },
    close() {
      clearPending(taskId);
      const client = clients.get(taskId);
      if (client) {
        try {
          client.controller.close();
        } catch {
          /* ignore */
        }
        clients.delete(taskId);
      }
    },
  };
}

export function registerClient(
  taskId: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
) {
  const prev = clients.get(taskId);
  if (prev) {
    try {
      prev.controller.close();
    } catch {
      /* ignore */
    }
  }

  clearPending(taskId);
  clients.set(taskId, { controller, encoder });

  const buffer = eventBuffer.get(taskId);
  if (buffer && buffer.length > 0) {
    for (const ev of buffer) {
      const msg = `event: ${ev.event}\ndata: ${ev.data}\n\n`;
      writeSseChunk(taskId, msg);
    }
  } else {
    const fromDisk = tryLoadLogsFromDisk(taskId);
    if (fromDisk) {
      eventBuffer.set(taskId, fromDisk);
      for (const ev of fromDisk) {
        const msg = `event: ${ev.event}\ndata: ${ev.data}\n\n`;
        writeSseChunk(taskId, msg);
      }
    }
  }
}

/** Bootstrap line(s) after registerClient (e.g. connected event) — respects backpressure */
export function writeSseBootstrap(taskId: string, rawSseLines: string) {
  writeSseChunk(taskId, rawSseLines);
}

export function unregisterClient(taskId: string) {
  clearPending(taskId);
  clients.delete(taskId);
}

export function getClient(taskId: string) {
  return clients.get(taskId);
}

export function clearBuffer(taskId: string) {
  eventBuffer.delete(taskId);
}
