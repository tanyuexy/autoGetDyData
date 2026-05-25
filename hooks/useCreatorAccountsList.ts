"use client";

import { useCallback, useEffect, useState } from "react";
import { App } from "antd";
import type { CreatorAccount } from "@/types";

export function useCreatorAccountsList() {
  const { message } = App.useApp();
  const [accounts, setAccounts] = useState<CreatorAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/creator/list");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch {
      message.error("获取账号列表失败");
    }
    setLoading(false);
  }, [message]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { accounts, loading, refresh };
}
