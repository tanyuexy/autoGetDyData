"use client";

import { useState } from "react";

interface UseTaskReturn {
  taskId: string | null;
  isRunning: boolean;
  startTask: (url: string, body?: any) => Promise<void>;
  cancelTask: () => void;
  resetTask: () => void;
}

export function useTask(): UseTaskReturn {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function startTask(url: string, body?: any) {
    setIsRunning(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) {
        const data = await res.json();
        setTaskId(data.taskId);
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
    setTaskId(null);
    setIsRunning(false);
  }

  function resetTask() {
    setTaskId(null);
    setIsRunning(false);
  }

  return { taskId, isRunning, startTask, cancelTask, resetTask };
}
