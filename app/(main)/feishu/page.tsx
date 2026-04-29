"use client";

import { useState } from "react";
import { Space, Divider, Select, InputNumber, App } from "antd";
import FeishuAuthPanel from "@/components/FeishuAuthPanel";
import TaskPanel from "@/components/TaskPanel";
import { useTaskContext } from "@/contexts/TaskContext";

export default function FeishuPage() {
  const { message } = App.useApp();
  const [profile, setProfile] = useState<string>("creator");
  const [keepRows, setKeepRows] = useState<number>(4);
  const [backupProfiles, setBackupProfiles] = useState<string>("creator,shop");

  const { taskId, isRunning, startTask, resetTask, logs, progress, done, exitCode, summary, clearLogs } = useTaskContext();

  async function handleBackup() {
    try {
      await startTask("/api/feishu/backup", { profiles: backupProfiles });
      message.info("备份任务已启动");
    } catch (e: any) {
      message.error(e.message || "启动失败");
    }
  }

  async function handleSync() {
    try {
      await startTask("/api/feishu/sync", { profile, keepRows });
      message.info("同步任务已启动");
    } catch (e: any) {
      message.error(e.message || "启动失败");
    }
  }

  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
      <div>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>OAuth 认证</h3>
        <FeishuAuthPanel />
      </div>

      <Divider />

      <div>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>数据操作</h3>
        <Space orientation="vertical" size="small" style={{ marginBottom: 8 }}>
          <Space>
            <span>备份配置：</span>
            <Select
              value={backupProfiles}
              onChange={setBackupProfiles}
              style={{ width: 200 }}
              options={[
                { value: "creator", label: "抖创" },
                { value: "shop", label: "抖店" },
                { value: "creator,shop", label: "全部" },
              ]}
            />
          </Space>
          <Space>
            <span>同步目标：</span>
            <Select
              value={profile}
              onChange={setProfile}
              style={{ width: 120 }}
              options={[
                { value: "creator", label: "抖创" },
                { value: "shop", label: "抖店" },
              ]}
            />
            <span>保留行数：</span>
            <InputNumber
              min={0}
              value={keepRows}
              onChange={(v) => setKeepRows(v ?? 0)}
              style={{ width: 80 }}
            />
          </Space>
        </Space>

        <TaskPanel
          taskId={taskId}
          isRunning={isRunning}
          taskButtons={[
            {
              key: "backup",
              label: "备份飞书表到 xlsx",
              onClick: handleBackup,
            },
            {
              key: "sync",
              label: `同步数据到飞书 (${profile})`,
              onClick: handleSync,
              danger: profile === "shop",
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
