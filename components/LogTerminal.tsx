"use client";

import { useEffect, useRef } from "react";
import { Button, Space, Typography } from "antd";
import { ClearOutlined, CopyOutlined } from "@ant-design/icons";
import type { LogEntry } from "@/types";

const { Text } = Typography;

interface Props {
  logs: LogEntry[];
  onClear?: () => void;
  height?: number | string;
}

const levelColors: Record<string, string> = {
  info: "#a9b7c6",
  warn: "#cc7832",
  error: "#ff6b68",
};

export default function LogTerminal({ logs, onClear, height }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  function handleCopy() {
    const text = logs.map((l) => `[${l.level.toUpperCase()}] ${l.text}`).join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const isEmpty = logs.length === 0;

  return (
    <div
      style={{
        background: "#2b2b2b",
        borderRadius: 6,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: typeof height === "number" ? height : height ?? 240,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "4px 12px",
          background: "#3c3f41",
          borderBottom: "1px solid #555",
        }}
      >
        <Text style={{ color: "#bbb", fontSize: 12 }}>执行日志</Text>
        <Space size="small">
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined />}
            onClick={handleCopy}
            style={{ color: "#bbb", fontSize: 12 }}
          >
            复制
          </Button>
          {onClear && (
            <Button
              size="small"
              type="text"
              icon={<ClearOutlined />}
              onClick={onClear}
              style={{ color: "#bbb", fontSize: 12 }}
            >
              清空
            </Button>
          )}
        </Space>
      </div>
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "8px 12px",
          fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
          fontSize: 12,
          lineHeight: "1.4",
          color: "#a9b7c6",
        }}
      >
        {isEmpty ? (
          <div style={{ color: "#666", fontStyle: "italic" }}>
            等待任务执行...
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={{ color: levelColors[log.level] || "#a9b7c6" }}>
              {log.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
