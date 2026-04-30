"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Space, Divider, App, Select, Typography, Button } from "antd";
import AccountTable from "@/components/AccountTable";
import { useTaskContext } from "@/contexts/TaskContext";
import type { CreatorAccount } from "@/types";

const { Text } = Typography;
const CREATOR_SELECTION_CACHE_KEY = "creator:selectedAccounts";

function readCachedCreatorSelection() {
  try {
    const cached = JSON.parse(
      window.localStorage.getItem(CREATOR_SELECTION_CACHE_KEY) || "[]"
    );
    return Array.isArray(cached) ? cached.map((name) => String(name)) : [];
  } catch {
    return [];
  }
}

export default function CreatorPage() {
  const { message } = App.useApp();
  const [accounts, setAccounts] = useState<CreatorAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedAccounts, setSelectedAccountsState] = useState<string[]>([]);
  const hasHydratedSelectionRef = useRef(false);
  const isApplyingInitialSelectionRef = useRef(false);

  const setSelectedAccounts = useCallback((value: string[]) => {
    setSelectedAccountsState(value);
    if (isApplyingInitialSelectionRef.current) return;
    try {
      window.localStorage.setItem(
        CREATOR_SELECTION_CACHE_KEY,
        JSON.stringify(value)
      );
    } catch {}
  }, []);

  const { startTask, resetTask, done } = useTaskContext();

  const fetchAccounts = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (done) {
      fetchAccounts();
      resetTask();
    }
  }, [done]);

  const validAccounts = useMemo(
    () => accounts.filter((a) => a.hasStorageState).map((a) => a.name),
    [accounts]
  );

  useEffect(() => {
    if (!validAccounts.length) return;

    isApplyingInitialSelectionRef.current = true;
    setSelectedAccountsState((prev) => {
      const cached = readCachedCreatorSelection().filter((name) =>
        validAccounts.includes(name)
      );

      if (!hasHydratedSelectionRef.current) {
        hasHydratedSelectionRef.current = true;
        if (cached.length > 0) return cached;
      }

      if (cached.length > 0) return cached;

      if (prev.length > 0) {
        return prev.filter((name) => validAccounts.includes(name));
      }
      return validAccounts;
    });
    isApplyingInitialSelectionRef.current = false;
  }, [validAccounts]);

  async function handleAction(action: "export" | "feishu-sync" | "sync-feishu") {
    if (!selectedAccounts.length) {
      message.warning("请先选择账号");
      return;
    }

    try {
      window.localStorage.setItem(
        CREATOR_SELECTION_CACHE_KEY,
        JSON.stringify(selectedAccounts)
      );
    } catch {}

    const endpoints: Record<string, string> = {
      export: "/api/creator/export",
      "feishu-sync": "/api/creator/feishu-sync",
      "sync-feishu": "/api/creator/sync-feishu",
    };

    try {
      await startTask(endpoints[action], { accounts: selectedAccounts });
      message.info("任务已启动");
    } catch (e: any) {
      message.error(e.message || "启动任务失败");
    }
  }

  const loggedInCount = accounts.filter((a) => a.hasStorageState).length;

  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
      <div>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>执行任务</h3>
        <div style={{ color: "rgba(15,23,42,.55)", marginBottom: 8, fontSize: 12 }}>
          已登录 {loggedInCount}/{accounts.length} 个账号
        </div>

        <Space wrap style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            选择账号：
          </Text>
          <Select
            mode="multiple"
            allowClear
            placeholder="请选择账号（默认选中已登录账号）"
            style={{ minWidth: 360 }}
            value={selectedAccounts}
            onChange={(v) => setSelectedAccounts(v)}
            options={accounts.map((a) => ({
              label: a.name,
              value: a.name,
              disabled: !a.hasStorageState,
            }))}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            未登录账号不可选
          </Text>
        </Space>

        <div>
        <Space wrap>
          <Button
            type="primary"
            onClick={() => handleAction("export")}
            disabled={accounts.length === 0}
          >
            导出数据
          </Button>
          <Button type="primary" onClick={() => handleAction("feishu-sync")}>
            同步多维表格
          </Button>
          <Button danger type="primary" onClick={() => handleAction("sync-feishu")}>
            导出并推送
          </Button>
        </Space>
        </div>

      </div>

      <Divider />

      <AccountTable
        type="creator"
        accounts={accounts}
        loading={loading}
        onRefresh={fetchAccounts}
      />
    </Space>
  );
}
