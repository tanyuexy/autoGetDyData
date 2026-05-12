"use client";

import { useEffect, useRef, useState } from "react";
import { Layout, Menu, theme, Button } from "antd";
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
} from "@ant-design/icons";
import { useRouter, usePathname } from "next/navigation";
import TaskPanel from "@/components/TaskPanel";
import { useTaskContext } from "@/contexts/TaskContext";

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
    key: "/review",
    icon: <AuditOutlined />,
    label: "稿文审核",
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
  const [todayText, setTodayText] = useState("");

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
  const {
    token: { borderRadiusLG },
  } = theme.useToken();

  const selectedKey = pathname || "/creator";

  useEffect(() => {
    setTodayText(
      new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
    );
  }, []);

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
        theme="light"
        width={180}
        trigger={
          <div className="sider-trigger">
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </div>
        }
        style={{
          margin: 12,
          borderRadius: 14,
          overflow: "hidden",
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
              style={{
                width: 28,
                height: 28,
                borderRadius: 10,
                flexShrink: 0,
                background:
                  "linear-gradient(135deg, rgba(59,130,246,.92), rgba(99,102,241,.75))",
                boxShadow: "0 10px 22px rgba(15, 23, 42, .10)",
              }}
            />
            <div
              className={`sider-header-text ${collapsed ? "collapsed" : ""}`}
              style={{ lineHeight: 1.1 }}
            >
              <div style={{ color: "rgba(15,23,42,.92)", fontSize: 13, fontWeight: 650, whiteSpace: "nowrap" }}>
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
          theme="light"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
          style={{ padding: 6, borderInlineEnd: 0 }}
        />

      </Sider>

      <Layout style={{ background: "transparent" }}>
        <Content
          className="glass"
          style={{
            margin: 12,
            marginLeft: 0,
            padding: 16,
            borderRadius: borderRadiusLG,
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
                  <ConsoleSqlOutlined />
                  <span style={{ fontSize: 12, color: "rgba(15,23,42,.82)", fontWeight: 650 }}>
                    命令行 / 任务日志
                  </span>
                  {activeViewId ? (
                    <span style={{ fontSize: 11, color: "rgba(15,23,42,.45)" }}>ID: {activeViewId}</span>
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
