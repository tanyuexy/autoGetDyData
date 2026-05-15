"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Space, Divider, App, Select, Typography, Button } from "antd";
import AccountTable from "@/components/AccountTable";
import { useTaskContext } from "@/contexts/TaskContext";
import type { CreatorAccount } from "@/types";

const { Text } = Typography;

/** Select 第一项「一键全选」的哨兵值，不会作为账号名传给接口 */
const MULTI_SELECT_ALL_ACCOUNTS = "__toolbar_all_creator_export_accounts__";

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

  const { startTask, done, isNamespaceBusy } = useTaskContext();

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
    }
  }, [done]);

  const validAccounts = useMemo(
    () => accounts.filter((a) => a.hasStorageState).map((a) => a.name),
    [accounts]
  );

  const accountSelectOptions = useMemo(
    () => [
      {
        label: validAccounts.length
          ? `全选（${validAccounts.length} 个已登录账号）`
          : "全选（无已登录账号）",
        value: MULTI_SELECT_ALL_ACCOUNTS,
        disabled: validAccounts.length === 0,
      },
      ...accounts.map((a) => ({
        label: a.name,
        value: a.name,
        disabled: !a.hasStorageState,
      })),
    ],
    [accounts, validAccounts.length]
  );

  const exportAccountsSanitized = useMemo(
    () => selectedAccounts.filter((name) => validAccounts.includes(name)),
    [selectedAccounts, validAccounts]
  );

  const handleAccountSelectChange = useCallback((vals: string[]) => {
    const picked = [...new Set(vals)];
    if (picked.includes(MULTI_SELECT_ALL_ACCOUNTS)) {
      setSelectedAccounts([...validAccounts]);
      return;
    }
    setSelectedAccounts(picked.filter((v) => v !== MULTI_SELECT_ALL_ACCOUNTS));
  }, [setSelectedAccounts, validAccounts]);

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
    if (!exportAccountsSanitized.length) {
      message.warning("请先选择账号");
      return;
    }

    try {
      window.localStorage.setItem(
        CREATOR_SELECTION_CACHE_KEY,
        JSON.stringify(exportAccountsSanitized)
      );
    } catch {}

    const endpoints: Record<string, string> = {
      export: "/api/creator/export",
      "feishu-sync": "/api/creator/feishu-sync",
      "sync-feishu": "/api/creator/sync-feishu",
    };

    try {
      await startTask(
        endpoints[action],
        { accounts: exportAccountsSanitized },
        "creator-export"
      );
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
            value={exportAccountsSanitized}
            onChange={(v) => handleAccountSelectChange(v as string[])}
            options={accountSelectOptions}
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
            disabled={accounts.length === 0 || isNamespaceBusy("creator-export")}
          >
            导出数据
          </Button>
          <Button
            type="primary"
            onClick={() => handleAction("feishu-sync")}
            disabled={isNamespaceBusy("creator-export")}
          >
            同步多维表格
          </Button>
          <Button
            danger
            type="primary"
            onClick={() => handleAction("sync-feishu")}
            disabled={isNamespaceBusy("creator-export")}
          >
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
        centerHeader
      />
    </Space>
  );
}
