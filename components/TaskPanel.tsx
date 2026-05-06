"use client";

import { useEffect, useState, useRef } from "react";
import { Button, Space, Progress, Alert, Tag, Typography, Select } from "antd";
import {
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import LogTerminal from "./LogTerminal";
import { useTaskContext } from "@/contexts/TaskContext";

const { Text } = Typography;

const NAMESPACE_LABELS: Record<string, string> = {
  "creator-export": "抖创导出",
  "creator-feishu-sync": "抖创同步",
  "creator-export-push": "抖创推送",
  "shop-export": "抖店导出",
  "shop-feishu-sync": "抖店同步",
  "shop-export-push": "抖店推送",
  "creator-publish": "发布",
  "creator-login": "抖创登录",
  "shop-login": "抖店登录",
  login: "登录",
  system: "系统",
  feishu: "飞书",
};

interface RecentLogFile {
  taskId: string;
  date: string;
  firstLine: string;
  hasDone: boolean;
  exitCode: number | null;
  namespace: string;
  mtime: number;
}

interface Props {
  taskButtons: {
    key: string;
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
  }[];
  terminalHeight?: number;
}

export default function TaskPanel({ taskButtons, terminalHeight }: Props) {
  const {
    activeViewId,
    logs,
    progress,
    done,
    exitCode,
    summary,
    isRunning,
    clearLogs,
    selectTaskLog,
  } = useTaskContext();

  const [recentFiles, setRecentFiles] = useState<RecentLogFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const loadedRef = useRef(false);
  const showHeader = taskButtons.length > 0;

  async function fetchRecentLogs() {
    setLoadingFiles(true);
    try {
      const res = await fetch("/api/progress/recent-logs");
      const data = await res.json();
      setRecentFiles((data.files || []) as RecentLogFile[]);
    } catch {
      /* ignore */
    }
    setLoadingFiles(false);
  }

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      fetchRecentLogs();
    }
    const interval = setInterval(fetchRecentLogs, 10000);
    return () => clearInterval(interval);
  }, []);

  function formatRecentLogOptionText(f: RecentLogFile) {
    const doneIcon = f.hasDone
      ? f.exitCode === 0
        ? "✓"
        : "✗"
      : "";
    const nsLabel = NAMESPACE_LABELS[f.namespace] || f.namespace;
    const timeStr = new Date(f.mtime)
      .toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      .replace(/\//g, "-")
      .replace(/\s/g, " ");
    return `${nsLabel} ${doneIcon} ${f.taskId.slice(0, 32)} (${timeStr})`.trim();
  }

  return (
    <div
      style={{
        width: "100%",
        height: terminalHeight ?? "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {showHeader && (
        <Space wrap style={{ marginBottom: 8 }}>
          {taskButtons.map((btn) => (
            <Button
              key={btn.key}
              type="primary"
              danger={btn.danger}
              icon={<PlayCircleOutlined />}
              onClick={btn.onClick}
              loading={isRunning && !done}
              disabled={btn.disabled}
            >
              {btn.label}
            </Button>
          ))}
          {isRunning && (
            <Tag color="processing" icon={<ReloadOutlined spin />}>
              任务运行中
            </Tag>
          )}
        </Space>
      )}

      {/* Task log selector — replaces old Tabs + running-tasks list */}
      <div style={{ marginBottom: 8, flexShrink: 0 }}>
        <Select
          showSearch
          allowClear
          placeholder={loadingFiles ? "加载日志列表..." : "选择历史日志查看"}
          value={activeViewId || undefined}
          onChange={async (val) => {
            if (!val) return;
            const found = recentFiles.find((f) => f.taskId === val);
            if (found?.hasDone) {
              await selectTaskLog(val, true);
            } else {
              await selectTaskLog(val, false);
            }
          }}
          onOpenChange={(open) => {
            if (open) fetchRecentLogs();
          }}
          loading={loadingFiles}
          style={{ width: "100%" }}
          size="small"
          filterOption={(input, option) => {
            if (!option?.value) return false;
            const value = String(option.value);
            const meta = recentFiles.find((f) => f.taskId === value);
            const searchText = [
              value,
              meta?.firstLine,
              NAMESPACE_LABELS[meta?.namespace || ""],
            ]
              .join(" ")
              .toLowerCase();
            return searchText.includes(input.toLowerCase());
          }}
          options={recentFiles.map((f) => ({
            value: f.taskId,
            label: formatRecentLogOptionText(f),
          }))}
        />
      </div>

      {done && (
        <Alert
          type={exitCode === 0 ? "success" : "error"}
          title={
            <Space>
              {exitCode === 0 ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              <Text>{summary || `任务完成，退出码: ${exitCode}`}</Text>
              {exitCode === 0 && <Tag color="success">成功</Tag>}
              {exitCode !== 0 && exitCode !== null && <Tag color="error">失败</Tag>}
            </Space>
          }
          showIcon={false}
          style={{ marginBottom: 8, flexShrink: 0 }}
        />
      )}

      {isRunning && !done && activeViewId && (
        <div style={{ marginBottom: 8, flexShrink: 0 }}>
          <Text type="secondary" style={{ marginRight: 8 }}>
            任务运行中...
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            ID: {activeViewId}
          </Text>
        </div>
      )}

      {progress && (
        <Progress
          percent={Math.round((progress.current / progress.total) * 100)}
          format={() => `${progress.current}/${progress.total}`}
          status={done ? (exitCode === 0 ? "success" : "exception") : "active"}
          style={{ marginBottom: 8, flexShrink: 0 }}
        />
      )}

      <LogTerminal logs={logs} onClear={clearLogs} height="100%" />
    </div>
  );
}
