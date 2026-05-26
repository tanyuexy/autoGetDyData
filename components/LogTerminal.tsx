"use client";

import { useEffect, useRef } from "react";
import { App, Button, Modal, Space, Typography } from "antd";
import { ClearOutlined, CopyOutlined } from "@ant-design/icons";
import type { LogEntry } from "@/types";
import { copyToClipboard } from "@/lib/copyToClipboard";

const { Text } = Typography;
const AUTO_SCROLL_THRESHOLD = 24;

/**
 * 日志区内置暗色终端配色（与应用「奶油 / 电绿」皮肤解耦），保证正文与链接级可读性。
 */
const T = {
  bg: "#141414",
  headerBg: "#1a1a1c",
  border: "#3f3f46",
  text: "#e4e4e7",
  info: "#b8c0cc",
  warn: "#e3b341",
  error: "#f87171",
  muted: "#71767a",
} as const;

function levelColor(level: LogEntry["level"]): string {
  if (level === "warn") return T.warn;
  if (level === "error") return T.error;
  return T.info;
}

interface Props {
  logs: LogEntry[];
  onClear?: () => void;
  height?: number | string;
}

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
          fontFamily: "'JetBrains Mono', ui-monospace, Consolas, 'Liberation Mono', Menlo, monospace",
          fontSize: 12,
          lineHeight: 1.4,
          color: "#111111",
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

    const ok = await copyToClipboard(text);
    if (ok) {
      message.success("已复制到剪贴板");
      return;
    }

    openManualCopyModal(text);
  }

  const isEmpty = logs.length === 0;

  return (
    <div
      className="log-terminal-surface"
      style={{
        background: T.bg,
        borderRadius: 6,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${T.border}`,
        height: typeof height === "number" ? height : height ?? 240,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "4px 12px",
          background: T.headerBg,
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <Text style={{ color: T.text, fontSize: 12 }}>执行日志</Text>
        <Space size="small">
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined />}
            onClick={handleCopy}
            style={{ color: T.text, fontSize: 12 }}
          >
            复制
          </Button>
          {onClear && (
            <Button
              size="small"
              type="text"
              icon={<ClearOutlined />}
              onClick={onClear}
              style={{ color: T.text, fontSize: 12 }}
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
          fontFamily:
            "'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
          fontSize: 13,
          lineHeight: 1.55,
          color: T.text,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          overflowWrap: "anywhere",
        }}
      >
        {isEmpty ? (
          <div style={{ color: T.muted, fontStyle: "italic" }}>等待任务执行...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={{ color: levelColor(log.level) }}>
              {log.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
