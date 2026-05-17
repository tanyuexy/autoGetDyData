"use client";

import { useEffect, useRef } from "react";
import { App, Button, Modal, Space, Typography } from "antd";
import { ClearOutlined, CopyOutlined } from "@ant-design/icons";
import type { LogEntry } from "@/types";

const { Text } = Typography;
const AUTO_SCROLL_THRESHOLD = 24;

interface Props {
  logs: LogEntry[];
  onClear?: () => void;
  height?: number | string;
}

const levelColors: Record<string, string> = {
  info: "#a9b7c6",
  warn: "#f0c674",
  error: "#ff6b68",
};

/** 剪贴板 API 不可用或写入失败时（如非安全上下文），弹出可选中区域由用户 ⌘C/Ctrl+C 复制 */
function openManualCopyModal(text: string) {
  Modal.info({
    title: "请手动复制日志（框内已全选，⌘C / Ctrl+C）",
    width: 720,
    icon: null,
    destroyOnHidden: true,
    content: (
      <textarea
        readOnly
        rows={16}
        defaultValue={text}
        style={{
          width: "100%",
          boxSizing: "border-box",
          marginTop: 8,
          fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
          fontSize: 12,
          lineHeight: 1.4,
        }}
        onFocus={(e) => e.currentTarget.select()}
        ref={(el) => {
          if (el) {
            queueMicrotask(() => {
              el.focus();
              el.select();
            });
          }
        }}
      />
    ),
    okText: "关闭",
  });
}

export default function LogTerminal({ logs, onClear, height }: Props) {
  const { message } = App.useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    if (containerRef.current && shouldAutoScrollRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const distanceToBottom = scrollHeight - (scrollTop + clientHeight);
    shouldAutoScrollRef.current = distanceToBottom <= AUTO_SCROLL_THRESHOLD;
  }

  async function handleCopy() {
    const text = logs.map((l) => `[${l.level.toUpperCase()}] ${l.text}`).join("\n");
    if (!text.trim()) {
      message.warning("暂无日志可复制");
      return;
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        message.success("已复制到剪贴板");
        return;
      } catch {
        /* 无权限等：走手动复制 */
      }
    }

    openManualCopyModal(text);
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
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "8px 12px",
          fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
          fontSize: 12,
          lineHeight: "1.4",
          color: "#a9b7c6",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          overflowWrap: "anywhere",
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
