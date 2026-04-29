"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";
import type { LogEntry, TaskProgress } from "@/types";

interface TaskContextValue {
  taskId: string | null;
  isRunning: boolean;
  logs: LogEntry[];
  progress: TaskProgress | null;
  done: boolean;
  exitCode: number | null;
  summary: string;
  startTask: (url: string, body?: any) => Promise<void>;
  cancelTask: () => void;
  resetTask: () => void;
  clearLogs: () => void;
}

const TaskContext = createContext<TaskContextValue>({
  taskId: null,
  isRunning: false,
  logs: [],
  progress: null,
  done: false,
  exitCode: null,
  summary: "",
  startTask: async () => {},
  cancelTask: () => {},
  resetTask: () => {},
  clearLogs: () => {},
});

export function useTaskContext() {
  return useContext(TaskContext);
}

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [done, setDone] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [summary, setSummary] = useState("");
  const logsRef = useRef<LogEntry[]>([]);
  const esRef = useRef<EventSource | null>(null);

  function connectSSE(id: string) {
    // Close existing connection
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource(`/api/progress/${id}`);
    esRef.current = es;

    es.addEventListener("log", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as LogEntry;
        logsRef.current = [...logsRef.current, data];
        setLogs([...logsRef.current]);
      } catch {}
    });

    es.addEventListener("progress", (e: MessageEvent) => {
      try {
        setProgress(JSON.parse(e.data));
      } catch {}
    });

    es.addEventListener("done", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setDone(true);
        setExitCode(data.code);
        setSummary(data.summary);
      } catch {}
      es.close();
      esRef.current = null;
    });

    es.onerror = () => {
      // Auto-reconnect handled by EventSource
    };
  }

  async function startTask(url: string, body?: any) {
    setIsRunning(true);
    setDone(false);
    setExitCode(null);
    setSummary("");
    setLogs([]);
    logsRef.current = [];
    setProgress(null);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) {
        const data = await res.json();
        setTaskId(data.taskId);
        connectSSE(data.taskId);
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
    } catch (e: any) {
      setIsRunning(false);
      throw e;
    }
  }

  function cancelTask() {
    if (taskId) {
      fetch(`/api/progress/${taskId}`, { method: "DELETE" }).catch(() => {});
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setTaskId(null);
    setIsRunning(false);
  }

  function resetTask() {
    setTaskId(null);
    setIsRunning(false);
  }

  function clearLogs() {
    logsRef.current = [];
    setLogs([]);
  }

  return (
    <TaskContext.Provider
      value={{
        taskId,
        isRunning,
        logs,
        progress,
        done,
        exitCode,
        summary,
        startTask,
        cancelTask,
        resetTask,
        clearLogs,
      }}
    >
      {children}
    </TaskContext.Provider>
  );
}
