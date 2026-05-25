"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Space, Divider, App, Typography, Button } from "antd";
import AccountTable from "@/components/AccountTable";
import { ToolbarMultiSelect } from "@/components/ToolbarMultiSelect";
import { useTaskContext } from "@/contexts/TaskContext";
import { useToolbarMultiSelect } from "@/hooks/useToolbarMultiSelect";
import { SELECT_ALL_CREATOR_EXPORT } from "@/lib/toolbarMultiSelect";
import type { CreatorAccount } from "@/types";

const { Text } = Typography;

const CREATOR_SELECTION_CACHE_KEY = "creator:selectedAccounts";

export default function CreatorPage() {
  const { message } = App.useApp();
  const [accounts, setAccounts] = useState<CreatorAccount[]>([]);
  const [loading, setLoading] = useState(true);

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
  }, [message]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (done) {
      fetchAccounts();
    }
  }, [done, fetchAccounts]);

  const validAccounts = useMemo(
    () => accounts.filter((a) => a.hasStorageState).map((a) => a.name),
    [accounts]
  );

  const itemOptions = useMemo(
    () =>
      accounts.map((a) => ({
        label: a.name,
        value: a.name,
        disabled: !a.hasStorageState,
      })),
    [accounts]
  );

  const toolbarMultiSelect = useToolbarMultiSelect({
    allValues: validAccounts,
    selectAllToken: SELECT_ALL_CREATOR_EXPORT,
    selectAllLabel: validAccounts.length
      ? `全选（${validAccounts.length} 个已登录账号）`
      : "全选（无已登录账号）",
    cacheKey: CREATOR_SELECTION_CACHE_KEY,
    itemOptions,
  });

  async function handleAction(action: "export" | "feishu-sync" | "sync-feishu") {
    if (!toolbarMultiSelect.sanitized.length) {
      message.warning("请先选择账号");
      return;
    }

    toolbarMultiSelect.persistSelection(toolbarMultiSelect.sanitized);

    const endpoints: Record<string, string> = {
      export: "/api/creator/export",
      "feishu-sync": "/api/creator/feishu-sync",
      "sync-feishu": "/api/creator/sync-feishu",
    };

    try {
      await startTask(
        endpoints[action],
        { accounts: toolbarMultiSelect.sanitized },
        "creator-export"
      );
      message.info("任务已启动");
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "启动任务失败");
    }
  }

  const loggedInCount = accounts.filter((a) => a.hasStorageState).length;

  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
      <div>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>执行任务</h3>
        <div style={{ color: "var(--vol-mute)", marginBottom: 8, fontSize: 12 }}>
          已登录 {loggedInCount}/{accounts.length} 个账号
        </div>

        <Space wrap style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            选择账号：
          </Text>
          <ToolbarMultiSelect
            value={toolbarMultiSelect.sanitized}
            onChange={toolbarMultiSelect.handleChange}
            options={toolbarMultiSelect.selectOptions}
            placeholder="请选择账号（默认选中已登录账号）"
            minWidth={360}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            未登录账号不可选
          </Text>
        </Space>

        <div>
          <Space wrap>
            <Button
              type="primary"
              onClick={() => void handleAction("export")}
              disabled={accounts.length === 0 || isNamespaceBusy("creator-export")}
            >
              导出数据
            </Button>
            <Button
              type="primary"
              onClick={() => void handleAction("feishu-sync")}
              disabled={isNamespaceBusy("creator-export")}
            >
              同步多维表格
            </Button>
            <Button
              danger
              type="primary"
              onClick={() => void handleAction("sync-feishu")}
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
