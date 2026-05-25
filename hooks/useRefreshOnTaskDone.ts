"use client";

import { useEffect, useRef } from "react";
import { useTaskContext } from "@/contexts/TaskContext";

export function useRefreshOnTaskDone(namespace: string, onRefresh: () => void) {
  const { activeTasks } = useTaskContext();
  const doneTaskIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let shouldRefresh = false;

    for (const [id, state] of activeTasks) {
      if (state.namespace === namespace && state.done) {
        if (!doneTaskIdsRef.current.has(id)) {
          doneTaskIdsRef.current.add(id);
          shouldRefresh = true;
        }
      }
    }

    if (shouldRefresh) {
      onRefresh();
    }
  }, [activeTasks, namespace, onRefresh]);
}
