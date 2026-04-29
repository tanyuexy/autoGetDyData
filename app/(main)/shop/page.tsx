"use client";

import { useState, useEffect, useCallback } from "react";
import { Space, Divider, App } from "antd";
import AccountTable from "@/components/AccountTable";
import TaskPanel from "@/components/TaskPanel";
import { useTaskContext } from "@/contexts/TaskContext";
import type { ShopAccount } from "@/types";

export default function ShopPage() {
  const { message } = App.useApp();
  const [accounts, setAccounts] = useState<ShopAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const { taskId, isRunning, startTask, resetTask, logs, progress, done, exitCode, summary, clearLogs } = useTaskContext();

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/shop/list");
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

  async function handleAction(action: "export" | "feishu-sync" | "sync-feishu") {
    const endpoints: Record<string, string> = {
      export: "/api/shop/export",
      "feishu-sync": "/api/shop/feishu-sync",
      "sync-feishu": "/api/shop/sync-feishu",
    };
    try {
      await startTask(endpoints[action]);
      message.info("任务已启动");
    } catch (e: any) {
      message.error(e.message || "启动任务失败");
    }
  }

  const loggedInCount = accounts.filter((a) => a.hasStorageState).length;

  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
      <AccountTable
        type="shop"
        accounts={accounts}
        loading={loading}
        onRefresh={fetchAccounts}
      />

      <Divider />

      <div>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>执行任务</h3>
        <div style={{ color: "#888", marginBottom: 8, fontSize: 12 }}>
          已登录 {loggedInCount}/{accounts.length} 个邮箱
        </div>

        <TaskPanel
          taskId={taskId}
          isRunning={isRunning}
          taskButtons={[
            {
              key: "export",
              label: "导出数据",
              onClick: () => handleAction("export"),
              disabled: accounts.length === 0,
            },
            {
              key: "feishu-sync",
              label: "同步多维表格",
              onClick: () => handleAction("feishu-sync"),
            },
            {
              key: "sync-feishu",
              label: "导出并推送",
              onClick: () => handleAction("sync-feishu"),
              danger: true,
            },
          ]}
          logs={logs}
          progress={progress}
          done={done}
          exitCode={exitCode}
          summary={summary}
          onClearLogs={clearLogs}
        />
      </div>
    </Space>
  );
}
