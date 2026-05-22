"use client";

import { useRef, useState } from "react";
import { Layout, Menu, Button, Segmented, Tooltip } from "antd";
import {
  VideoCameraOutlined,
  ShoppingOutlined,
  CloudOutlined,
  SettingOutlined,
  ConsoleSqlOutlined,
  MinusOutlined,
  CloseOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  AuditOutlined,
  MessageOutlined,
  ThunderboltOutlined,
  CoffeeOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { useRouter, usePathname } from "next/navigation";
import TaskPanel from "@/components/TaskPanel";
import { useTaskContext } from "@/contexts/TaskContext";
import { useAppUiTheme } from "@/contexts/UIThemeContext";
import type { AppUiTheme } from "@/lib/appUiTheme";

const { Sider, Content } = Layout;
const menuItems = [
  {
    key: "/creator",
    icon: <VideoCameraOutlined />,
    label: "抖创数据",
  },
  {
    key: "/shop",
    icon: <ShoppingOutlined />,
    label: "抖店数据",
  },
  {
    key: "/creator/publish",
    icon: <VideoCameraOutlined />,
    label: "定时发布",
  },
  {
    key: "/ai-video",
    icon: <PlayCircleOutlined />,
    label: "AI视频生成",
  },
  {
    key: "/review",
    icon: <AuditOutlined />,
    label: "作品信息",
  },
  {
    key: "/comment",
    icon: <MessageOutlined />,
    label: "评论管理",
  },
  {
    key: "/feishu",
    icon: <CloudOutlined />,
    label: "飞书授权",
  },
  {
    key: "/config",
    icon: <SettingOutlined />,
    label: "配置管理",
  },
];

type Pos = { x: number; y: number };

type DragState = {
  dragging: boolean;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
};

const TERMINAL_SIZE = { w: 720, h: 460 };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { theme: uiTheme, setTheme, toggleTheme } = useAppUiTheme();

  const {
    terminalOpen,
    terminalMinimized,
    openTerminal,
    minimizeTerminal,
    closeTerminal,
    restoreTerminal,
    activeViewId,
    isRunning,
    done,
    cancelTask,
  } = useTaskContext();
  const dragRef = useRef<DragState | null>(null);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });

  const router = useRouter();
  const pathname = usePathname();

  const selectedKey = pathname || "/creator";

  function onMouseDownDrag(e: React.MouseEvent) {
    if (terminalMinimized) return;
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      baseX: pos.x,
      baseY: pos.y,
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current?.dragging) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPos({ x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy });
    };

    const onUp = () => {
      if (dragRef.current) dragRef.current.dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <Layout className="app-shell" style={{ minHeight: "100vh" }}>
      <Sider
        className="glass"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme={uiTheme === "voltagent" ? "dark" : "light"}
        width={180}
        trigger={
          <div className="sider-trigger">
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </div>
        }
        style={{
          margin: 12,
          borderRadius: 12,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            height: 44,
            margin: 12,
            display: "flex",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={
                uiTheme === "intercom"
                  ? {
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      flexShrink: 0,
                      background: "#111111",
                      border: "1px solid #111111",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontSize: 13,
                      fontWeight: 600,
                      lineHeight: 1,
                    }
                  : {
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      flexShrink: 0,
                      background: "var(--ic-canvas)",
                      border: "1px solid var(--ic-hairline)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--vol-primary)",
                      fontSize: 15,
                      fontWeight: 700,
                      lineHeight: 1,
                    }
              }
              aria-hidden
            >
              {uiTheme === "intercom" ? "数" : "⚡"}
            </div>
            <div
              className={`sider-header-text ${collapsed ? "collapsed" : ""}`}
              style={{ lineHeight: 1.1 }}
            >
              <div style={{ color: "var(--vol-ink)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                抖店/抖创
              </div>
              <div className="panel-title" style={{ marginTop: 2, whiteSpace: "nowrap" }}>
                数据工具台
              </div>
            </div>
          </div>
          {/* <div className={`sider-date ${collapsed ? "collapsed" : ""}`} style={{ marginLeft: "auto" }}>
            <span suppressHydrationWarning>{todayText}</span>
          </div> */}
        </div>

        <Menu
          theme={uiTheme === "voltagent" ? "dark" : "light"}
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
          style={{
            padding: 6,
            borderInlineEnd: 0,
            background: "transparent",
            flex: 1,
            border: "none",
            minHeight: 0,
          }}
        />

        <div
          style={{
            padding: "10px 12px",
            borderTop: "1px solid var(--ic-hairline)",
            flexShrink: 0,
          }}
        >
          {!collapsed ? (
            <Segmented<AppUiTheme>
              block
              size="small"
              value={uiTheme}
              onChange={(v) => setTheme(v)}
              options={[
                { label: "奶油", value: "intercom" },
                { label: "电绿", value: "voltagent" },
              ]}
            />
          ) : (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Tooltip
                title={
                  uiTheme === "intercom"
                    ? "当前：Intercom 奶油风 · 点击切换 Voltagent 电绿"
                    : "当前：Voltagent 电绿风 · 点击切换 Intercom 奶油"
                }
              >
                <Button
                  type="text"
                  icon={uiTheme === "intercom" ? <CoffeeOutlined /> : <ThunderboltOutlined />}
                  onClick={() => toggleTheme()}
                  aria-label="切换界面风格"
                />
              </Tooltip>
            </div>
          )}
        </div>
      </Sider>

      <Layout style={{ background: "transparent" }}>
        <Content
          className="glass"
          style={{
            margin: 12,
            marginLeft: 0,
            padding: 20,
            borderRadius: 12,
            minHeight: 200,
            overflow: "auto",
          }}
        >
          {children}
        </Content>
      </Layout>

      {!terminalOpen && (
        <button
          type="button"
          className="terminal-float-launch"
          onClick={() => openTerminal()}
          aria-label="打开命令行"
          title="打开命令行"
        >
          <ConsoleSqlOutlined />
        </button>
      )}

      {terminalOpen && (
        <div
          className={terminalMinimized ? "terminal-float minimized" : "terminal-float"}
          style={
            terminalMinimized
              ? undefined
              : {
                  width: TERMINAL_SIZE.w,
                  height: TERMINAL_SIZE.h,
                  transform: `translateX(-50%) translate(${pos.x}px, ${pos.y}px)`,
                }
          }
        >
          {terminalMinimized ? (
            <button
              type="button"
              className="terminal-float-minibtn"
              onClick={() => restoreTerminal()}
              aria-label="展开命令行"
              title="展开命令行"
            >
              <ConsoleSqlOutlined />
            </button>
          ) : (
            <div
              className="terminal-float-card"
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div className="terminal-float-header" onMouseDown={onMouseDownDrag}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ConsoleSqlOutlined style={{ color: "var(--vol-primary)" }} />
                  <span style={{ fontSize: 12, color: "var(--vol-ink)", fontWeight: 600 }}>
                    命令行 / 任务日志
                  </span>
                  {activeViewId ? (
                    <span style={{ fontSize: 11, color: "var(--vol-mute)" }}>ID: {activeViewId}</span>
                  ) : null}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {isRunning && !done ? (
                    <Button danger size="small" onClick={() => activeViewId && cancelTask(activeViewId)}>
                      终止
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    icon={<MinusOutlined />}
                    onClick={() => minimizeTerminal()}
                  />
                  <Button
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => {
                      closeTerminal();
                    }}
                  />
                </div>
              </div>

              <div
                className="terminal-float-body"
                style={{ flex: 1, minHeight: 0 }}
              >
                <TaskPanel
                  taskButtons={[]}
                  terminalHeight={Math.max(160, TERMINAL_SIZE.h - 54 - 12)}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
