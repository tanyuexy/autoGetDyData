"use client";

import { useState, useEffect, useCallback } from "react";
import { Checkbox, Space, Divider, App } from "antd";
import AccountTable from "@/components/AccountTable";
import TaskPanel from "@/components/TaskPanel";
import { useTaskContext } from "@/contexts/TaskContext";
import type { CreatorAccount } from "@/types";

export default function CreatorPage() {
  const { message } = App.useApp();
  const [accounts, setAccounts] = useState<CreatorAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [syncFeishu, setSyncFeishu] = useState(false);

  const { taskId, isRunning, startTask, resetTask, logs, progress, done, exitCode, summary, clearLogs } = useTaskContext();

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/creator/list");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
        // Select all by default
        setSelectedAccounts(data.accounts.map((a: CreatorAccount) => a.name));
      }
    } catch {
      message.error("获取账号列表失败");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // When task completes, refresh account list
  useEffect(() => {
    if (done) {
      fetchAccounts();
      resetTask();
    }
  }, [done]);

  async function handleExport() {
    try {
      await startTask("/api/creator/export", {
        accounts: selectedAccounts,
        syncFeishu,
      });
      message.info("任务已启动");
    } catch (e: any) {
      message.error(e.message || "启动任务失败");
    }
  }

  const loggedInCount = accounts.filter((a) => a.hasStorageState).length;

  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
      <AccountTable
        type="creator"
        accounts={accounts}
        loading={loading}
        onRefresh={fetchAccounts}
      />

      <Divider />

      <div>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>执行任务</h3>
        <Space orientation="vertical" size="small" style={{ marginBottom: 12 }}>
          <Checkbox.Group
            options={accounts.map((a) => ({
              label: `${a.name} ${a.hasStorageState ? "(已登录)" : "(未登录)"}`,
              value: a.name,
            }))}
            value={selectedAccounts}
            onChange={(values) => setSelectedAccounts(values as string[])}
          />
          <Checkbox
            checked={syncFeishu}
            onChange={(e) => setSyncFeishu(e.target.checked)}
          >
            完成后自动同步到飞书
          </Checkbox>
        </Space>
        <div style={{ color: "#888", marginBottom: 8, fontSize: 13 }}>
          已登录 {loggedInCount}/{accounts.length} 个账号
        </div>

        <TaskPanel
          taskId={taskId}
          isRunning={isRunning}
          taskButtons={[
            {
              key: "export",
              label: syncFeishu ? "导出 + 同步飞书" : "导出数据",
              onClick: handleExport,
              disabled: selectedAccounts.length === 0,
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
