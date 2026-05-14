"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { LogEntry, TaskProgress, RunningTaskInfo } from "@/types";

interface ActiveTaskState {
  taskId: string;
  namespace: string;
  logs: LogEntry[];
  progress: TaskProgress | null;
  done: boolean;
  exitCode: number | null;
  summary: string;
}

interface MultiTaskContextValue {
  /** All currently tracked tasks (including completed) */
  activeTasks: Map<string, ActiveTaskState>;
  /** Currently visible task ID */
  activeViewId: string | null;
  /** All tasks known to be running on server */
  runningTasks: RunningTaskInfo[];
  /** Set of namespaces that are at max capacity */
  busyNamespaces: Set<string>;
  /** Check if a namespace can accept new tasks */
  isNamespaceBusy: (namespace: string) => boolean;
  /** Active view's logs */
  logs: LogEntry[];
  /** Active view's progress */
  progress: TaskProgress | null;
  /** Active view's done state */
  done: boolean;
  /** Active view's exit code */
  exitCode: number | null;
  /** Active view's summary */
  summary: string;
  /** Whether any task is running */
  isRunning: boolean;
  /** Switch the log view to a different task */
  setActiveViewId: (id: string | null) => void;
  /** Start a task via API and connect its SSE */
  startTask: (url: string, body?: any, namespace?: string) => Promise<string>;
  /** Cancel a specific task */
  cancelTask: (taskId: string) => Promise<void>;
  /** Clear logs for the active view */
  clearLogs: () => void;
  /** Remove a completed task from tracking */
  removeTask: (taskId: string) => void;
  /** Select a task log: load disk content directly if done, else connect SSE */
  selectTaskLog: (taskId: string, isDone: boolean) => Promise<void>;
  /** Legacy: setTaskId (calls setActiveViewId internally) */
  setTaskId: (id: string | null) => void;
  /** Legacy: resetTask — clears all tracking */
  resetTask: () => void;
  /** Terminal panel state */
  terminalOpen: boolean;
  terminalMinimized: boolean;
  openTerminal: (taskId?: string) => void;
  minimizeTerminal: () => void;
  closeTerminal: () => void;
  restoreTerminal: () => void;
}

const MultiTaskContext = createContext<MultiTaskContextValue>({
  activeTasks: new Map(),
  activeViewId: null,
  runningTasks: [],
  busyNamespaces: new Set(),
  isNamespaceBusy: () => false,
  logs: [],
  progress: null,
  done: false,
  exitCode: null,
  summary: "",
  isRunning: false,
  setActiveViewId: () => {},
  startTask: async () => "",
  cancelTask: async () => {},
  clearLogs: () => {},
  removeTask: () => {},
  selectTaskLog: async () => {},
  setTaskId: () => {},
  resetTask: () => {},
  terminalOpen: false,
  terminalMinimized: false,
  openTerminal: () => {},
  minimizeTerminal: () => {},
  closeTerminal: () => {},
  restoreTerminal: () => {},
});

export function useTaskContext() {
  return useContext(MultiTaskContext);
}

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const [activeTasks, setActiveTasks] = useState<Map<string, ActiveTaskState>>(new Map());
  const [activeViewId, _setActiveViewId] = useState<string | null>(null);
  const [runningTasks, setRunningTasks] = useState<RunningTaskInfo[]>([]);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalMinimized, setTerminalMinimized] = useState(false);
  const [namespaceLimits, setNamespaceLimits] = useState<Record<string, number>>({
    "creator-export": 1,
    "shop-export": 1,
    login: 1,
    "creator-publish": 3,
    system: 1,
  });
  const connectionsRef = useRef<Map<string, EventSource>>(new Map());
  const logsRef = useRef<Map<string, LogEntry[]>>(new Map());
  const seenLogKeysRef = useRef<Map<string, Set<string>>>(new Map());
  const activeTasksRef = useRef(activeTasks);
  useEffect(() => {
    activeTasksRef.current = activeTasks;
  }, [activeTasks]);

  // Poll running tasks list + reconcile tabs when SSE dropped events but log file is complete
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch("/api/progress/tasks");
        const data = await r.json();
        const running: RunningTaskInfo[] = data.running || [];
        setRunningTasks(running);
        if (data.namespaceLimits && typeof data.namespaceLimits === "object") {
          setNamespaceLimits((prev) => ({ ...prev, ...data.namespaceLimits }));
        }
        const runningIds = new Set(running.map((t) => t.taskId));

        const toSync: string[] = [];
        for (const [id, st] of activeTasksRef.current) {
          if (!st.done && !runningIds.has(id)) toSync.push(id);
        }

        for (const id of toSync) {
          const sr = await fetch(`/api/progress/${encodeURIComponent(id)}/snapshot`);
          const snap = await sr.json();
          if (!snap.found || !Array.isArray(snap.logs)) continue;

          const diskLogs: LogEntry[] = snap.logs.map(
            (l: { text: string; level: string; timestamp: string }) => ({
              text: l.text,
              level: l.level === "error" || l.level === "warn" ? l.level : "info",
              timestamp: l.timestamp || "",
            })
          );

          const finished = Boolean(snap.done);
          if (!finished) {
            setActiveTasks((prev) => {
              const st = prev.get(id);
              if (!st || st.done) return prev;
              const next = new Map(prev);
              const newLogs = diskLogs.length >= st.logs.length ? diskLogs : st.logs;
              logsRef.current.set(id, newLogs);
              next.set(id, { ...st, logs: newLogs, done: false, exitCode: null, summary: "" });
              return next;
            });
            continue;
          }

          const exitCode = snap.exitCode != null ? snap.exitCode : -1;
          const summary = String(snap.summary || "");

          setActiveTasks((prev) => {
            const st = prev.get(id);
            if (!st || st.done) return prev;
            const next = new Map(prev);
            const newLogs = diskLogs.length >= st.logs.length ? diskLogs : st.logs;
            logsRef.current.set(id, newLogs);
            next.set(id, {
              ...st,
              logs: newLogs,
              done: true,
              exitCode,
              summary,
            });
            return next;
          });

          const es = connectionsRef.current.get(id);
          if (es) {
            es.close();
            connectionsRef.current.delete(id);
          }
        }
      } catch {
        /* ignore */
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 3000);
    return () => clearInterval(interval);
  }, []);

  // Compute busy namespaces from running tasks
  const busyNamespaces = useMemo(() => {
    const busy = new Set<string>();
    for (const ns of Object.keys(namespaceLimits)) {
      const max = namespaceLimits[ns];
      if (max == null || !Number.isFinite(max)) continue;
      const count = runningTasks.filter((t) => t.namespace === ns).length;
      if (count >= max) busy.add(ns);
    }
    return busy;
  }, [runningTasks, namespaceLimits]);

  function isNamespaceBusy(namespace: string): boolean {
    return busyNamespaces.has(namespace);
  }

  function openTerminal(taskId?: string) {
    if (taskId) {
      // Ensure task is tracked
      if (!activeTasks.has(taskId) && !logsRef.current.has(taskId)) {
        logsRef.current.set(taskId, []);
        setActiveTasks((prev) => {
          const next = new Map(prev);
          next.set(taskId, {
            taskId,
            namespace: "creator-publish",
            logs: [],
            progress: null,
            done: false,
            exitCode: null,
            summary: "",
          });
          return next;
        });
        connectSSE(taskId, "creator-publish");
      }
      _setActiveViewId(taskId);
    }
    setTerminalOpen(true);
    setTerminalMinimized(false);
  }

  function minimizeTerminal() { setTerminalMinimized(true); }
  function closeTerminal() { setTerminalOpen(false); setTerminalMinimized(false); }
  function restoreTerminal() { setTerminalMinimized(false); setTerminalOpen(true); }

  function getTaskState(id: string): ActiveTaskState {
    return {
      taskId: id,
      namespace: "system",
      logs: logsRef.current.get(id) || [],
      progress: null,
      done: false,
      exitCode: null,
      summary: "",
    };
  }

  function buildLogKey(entry: LogEntry) {
    return `${entry.timestamp || ""}|${entry.level || ""}|${entry.text || ""}`;
  }

  function resetSeenLogKeys(taskId: string, logs: LogEntry[] = []) {
    seenLogKeysRef.current.set(
      taskId,
      new Set((logs || []).map((entry) => buildLogKey(entry)))
    );
  }

  function connectSSE(id: string, ns: string) {
    // Close existing connection for this ID if any
    const existing = connectionsRef.current.get(id);
    if (existing) {
      existing.close();
      connectionsRef.current.delete(id);
    }

    const es = new EventSource(`/api/progress/${encodeURIComponent(id)}`);
    connectionsRef.current.set(id, es);

    es.addEventListener("log", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as LogEntry;
        const seen = seenLogKeysRef.current.get(id) || new Set<string>();
        const key = buildLogKey(data);
        if (seen.has(key)) return;
        seen.add(key);
        seenLogKeysRef.current.set(id, seen);

        const current = logsRef.current.get(id) || [];
        current.push(data);
        logsRef.current.set(id, current);

        setActiveTasks((prev) => {
          const next = new Map(prev);
          const st = next.get(id) || getTaskState(id);
          next.set(id, { ...st, namespace: st.namespace || ns, logs: [...current] });
          return next;
        });
      } catch (err) {
        // ignore parse errors
      }
    });

    es.addEventListener("message", (e: MessageEvent) => {
      // ignore generic messages
    });

    es.addEventListener("progress", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as TaskProgress;
        setActiveTasks((prev) => {
          const next = new Map(prev);
          const st = next.get(id) || getTaskState(id);
          next.set(id, { ...st, progress: data });
          return next;
        });
      } catch {}
    });

    es.addEventListener("done", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setActiveTasks((prev) => {
          const next = new Map(prev);
          const st = next.get(id) || getTaskState(id);
          next.set(id, {
            ...st,
            done: true,
            exitCode: data.code,
            summary: data.summary,
          });
          return next;
        });
      } catch (err) {
        // ignore parse errors
      }
      es.close();
      connectionsRef.current.delete(id);
    });

    es.onerror = (e) => {
      // ignore connection errors
    };

    es.onopen = () => {
      // connection established
    };
  }

  async function startTask(url: string, body?: any, ns?: string): Promise<string> {
    const namespace = ns || "system";

    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const taskId: string = data.taskId;
    logsRef.current.set(taskId, []);
    resetSeenLogKeys(taskId, []);

    setActiveTasks((prev) => {
      const next = new Map(prev);
      next.set(taskId, {
        taskId,
        namespace,
        logs: [],
        progress: null,
        done: false,
        exitCode: null,
        summary: "",
      });
      return next;
    });

    _setActiveViewId(taskId);
    connectSSE(taskId, namespace);
    return taskId;
  }

  async function cancelTask(taskId: string) {
    let ok = false;
    try {
      const res = await fetch(`/api/progress/${taskId}`, { method: "DELETE" });
      const data = await res.json();
      ok = data.ok;
    } catch (e) {
      // ignore request errors
    }
    // Don't close SSE — wait for the 'done' event which will close it naturally
    // If the process wasn't found on server, force close
    if (!ok) {
      const es = connectionsRef.current.get(taskId);
      if (es) {
        es.close();
        connectionsRef.current.delete(taskId);
      }
    }
    // Safety: if done event doesn't arrive within 10s, force-mark as done
    setTimeout(() => {
      setActiveTasks((prev) => {
        const next = new Map(prev);
        const st = next.get(taskId);
        if (st && !st.done) {
          next.set(taskId, { ...st, done: true, exitCode: -1, summary: "管理员手动终止" });
        }
        return next;
      });
      const es = connectionsRef.current.get(taskId);
      if (es) {
        es.close();
        connectionsRef.current.delete(taskId);
      }
    }, 10000);
  }

  function clearLogs() {
    if (activeViewId) {
      logsRef.current.set(activeViewId, []);
      resetSeenLogKeys(activeViewId, []);
      setActiveTasks((prev) => {
        const next = new Map(prev);
        const st = next.get(activeViewId);
        if (st) next.set(activeViewId, { ...st, logs: [] });
        return next;
      });
    }
  }

  async function selectTaskLog(taskId: string, isDone: boolean) {
    if (isDone) {
      // Task already completed — load disk content directly, no SSE
      let loadedLogs: LogEntry[] = [];
      let loadedExitCode: number | null = null;
      let loadedSummary = "任务已完成";

      try {
        const res = await fetch(`/api/progress/${encodeURIComponent(taskId)}/snapshot`);
        const snap = await res.json();
        if (snap.found && Array.isArray(snap.logs)) {
          loadedLogs = snap.logs.map(
            (l: { text: string; level: string; timestamp: string }) => ({
              text: l.text,
              level: l.level === "error" || l.level === "warn" ? l.level : "info",
              timestamp: l.timestamp || "",
            })
          );
          if (snap.done) {
            loadedExitCode = snap.exitCode ?? null;
            loadedSummary = snap.summary || loadedSummary;
          }
        }
      } catch {
        /* fall through with defaults */
      }

      // Always mark as done — caller confirmed this task completed.
      // Prevents the reconcile poll from overwriting with "日志未包含完成标记".
      logsRef.current.set(taskId, loadedLogs);
      resetSeenLogKeys(taskId, loadedLogs);
      setActiveTasks((prev) => {
        const next = new Map(prev);
        next.set(taskId, {
          taskId,
          namespace: "system",
          logs: loadedLogs,
          progress: null,
          done: true,
          exitCode: loadedExitCode,
          summary: loadedSummary,
        });
        return next;
      });
      _setActiveViewId(taskId);
      setTerminalOpen(true);
      setTerminalMinimized(false);
    } else {
      // Task still running — connect SSE for real-time streaming only
      const existing = connectionsRef.current.get(taskId);
      if (existing) {
        existing.close();
        connectionsRef.current.delete(taskId);
      }
      if (!activeTasks.has(taskId) && !logsRef.current.has(taskId)) {
        logsRef.current.set(taskId, []);
        resetSeenLogKeys(taskId, []);
        setActiveTasks((prev) => {
          const next = new Map(prev);
          next.set(taskId, {
            taskId,
            namespace: "creator-publish",
            logs: [],
            progress: null,
            done: false,
            exitCode: null,
            summary: "",
          });
          return next;
        });
      }
      connectSSE(taskId, "creator-publish");
      _setActiveViewId(taskId);
      setTerminalOpen(true);
      setTerminalMinimized(false);
    }
  }

  function removeTask(taskId: string) {
    const es = connectionsRef.current.get(taskId);
    if (es) {
      es.close();
      connectionsRef.current.delete(taskId);
    }
    logsRef.current.delete(taskId);
    seenLogKeysRef.current.delete(taskId);
    setActiveTasks((prev) => {
      const next = new Map(prev);
      next.delete(taskId);
      return next;
    });
    if (activeViewId === taskId) {
      const remaining = [...(activeTasks.keys())].filter((k) => k !== taskId);
      _setActiveViewId(remaining[remaining.length - 1] || null);
    }
  }

  // SSE-aware view switcher: auto-connects to SSE for tasks not yet tracked
  function setActiveViewId(id: string | null) {
    if (id) {
      if (!activeTasks.has(id) && !logsRef.current.has(id)) {
        logsRef.current.set(id, []);
        resetSeenLogKeys(id, []);
        setActiveTasks((prev) => {
          const next = new Map(prev);
          next.set(id, {
            taskId: id,
            namespace: "creator-publish",
            logs: [],
            progress: null,
            done: false,
            exitCode: null,
            summary: "",
          });
          return next;
        });
        connectSSE(id, "publish");
      }
    }
    _setActiveViewId(id);
  }

  function resetTask() {
    // Close all connections
    for (const es of connectionsRef.current.values()) es.close();
    connectionsRef.current.clear();
    logsRef.current.clear();
    seenLogKeysRef.current.clear();
    setActiveTasks(new Map());
    _setActiveViewId(null);
    setRunningTasks([]);
  }

  // Derive active view state for backward compat
  const activeState = activeViewId ? activeTasks.get(activeViewId) : undefined;

  const isRunning = [...activeTasks.values()].some((t) => !t.done);

  return (
    <MultiTaskContext.Provider
      value={{
        activeTasks,
        activeViewId,
        runningTasks,
        busyNamespaces,
        isNamespaceBusy,
        logs: activeState?.logs || [],
        progress: activeState?.progress || null,
        done: activeState?.done || false,
        exitCode: activeState?.exitCode ?? null,
        summary: activeState?.summary || "",
        isRunning,
        setActiveViewId,
        startTask,
        cancelTask,
        clearLogs,
        removeTask,
        selectTaskLog,
        setTaskId: setActiveViewId, // deprecated alias
        resetTask,
        terminalOpen,
        terminalMinimized,
        openTerminal,
        minimizeTerminal,
        closeTerminal,
        restoreTerminal,
      }}
    >
      {children}
    </MultiTaskContext.Provider>
  );
}
