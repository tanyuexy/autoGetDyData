"use client";

import { Button, Space, Progress, Alert, Tag, Typography } from "antd";
import {
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";
import LogTerminal from "./LogTerminal";
import { useSSE } from "@/hooks/useSSE";

const { Text } = Typography;

interface Props {
  taskId: string | null;
  isRunning: boolean;
  taskButtons: {
    key: string;
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
  }[];
  onClearLogs?: () => void;
  logs: ReturnType<typeof useSSE>["logs"];
  progress: ReturnType<typeof useSSE>["progress"];
  done: ReturnType<typeof useSSE>["done"];
  exitCode: ReturnType<typeof useSSE>["exitCode"];
  summary: ReturnType<typeof useSSE>["summary"];
  terminalHeight?: number;
}

export default function TaskPanel({
  taskId,
  isRunning,
  taskButtons,
  onClearLogs,
  logs,
  progress,
  done,
  exitCode,
  summary,
  terminalHeight,
}: Props) {
  const showHeader = taskButtons.length > 0;

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
              disabled={btn.disabled || (isRunning && !done)}
            >
              {btn.label}
            </Button>
          ))}
        </Space>
      )}

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
          style={{ marginBottom: 8 }}
        />
      )}

      {isRunning && !done && (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ marginRight: 8 }}>
            任务运行中...
          </Text>
          {taskId && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              ID: {taskId}
            </Text>
          )}
        </div>
      )}

      {progress && (
        <Progress
          percent={Math.round((progress.current / progress.total) * 100)}
          format={() => `${progress.current}/${progress.total}`}
          status={done ? (exitCode === 0 ? "success" : "exception") : "active"}
          style={{ marginBottom: 8 }}
        />
      )}

      <LogTerminal logs={logs} onClear={onClearLogs} height="100%" />
    </div>
  );
}
