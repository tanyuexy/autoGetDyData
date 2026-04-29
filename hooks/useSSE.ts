"use client";

import { useState, useEffect, useRef } from "react";
import type { LogEntry, TaskProgress, SSEDoneEvent } from "@/types";

export function useSSE(taskId: string | null) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [done, setDone] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [summary, setSummary] = useState<string>("");
  const logsRef = useRef<LogEntry[]>([]);

  useEffect(() => {
    if (!taskId) return;

    setLogs([]);
    setProgress(null);
    setDone(false);
    setExitCode(null);
    setSummary("");
    logsRef.current = [];

    const es = new EventSource(`/api/progress/${taskId}`);

    es.addEventListener("connected", () => {
      // Connected successfully
    });

    es.addEventListener("log", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as LogEntry;
        logsRef.current = [...logsRef.current, data];
        setLogs([...logsRef.current]);
      } catch { }
    });

    es.addEventListener("progress", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as TaskProgress;
        setProgress(data);
      } catch { }
    });

    es.addEventListener("done", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as SSEDoneEvent;
        setDone(true);
        setExitCode(data.code);
        setSummary(data.summary);
      } catch { }
      es.close();
    });

    es.onerror = () => {
      // EventSource will auto-reconnect
    };

    return () => {
      es.close();
    };
  }, [taskId]);

  return { logs, progress, done, exitCode, summary };
}
