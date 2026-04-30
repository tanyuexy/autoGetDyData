"use client";

import { useRef, useState } from "react";
import { Layout, Menu, theme, Typography, Button } from "antd";
import {
  VideoCameraOutlined,
  ShoppingOutlined,
  CloudOutlined,
  SettingOutlined,
  ConsoleSqlOutlined,
  MinusOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import { useRouter, usePathname } from "next/navigation";
import TaskPanel from "@/components/TaskPanel";
import { useTaskContext } from "@/contexts/TaskContext";

const { Sider, Content } = Layout;
const { Text } = Typography;

const menuItems = [
  {
    key: "/creator",
    icon: <VideoCameraOutlined />,
    label: "抖创数据",
  },
  {
    key: "/creator/publish",
    icon: <VideoCameraOutlined />,
    label: "定时发布",
  },
  {
    key: "/shop",
    icon: <ShoppingOutlined />,
    label: "抖店数据",
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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalMinimized, setTerminalMinimized] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 680, h: 460 });
  const resizeRef = useRef<
    | null
    | {
        resizing: boolean;
        startX: number;
        startY: number;
        baseW: number;
        baseH: number;
      }
  >(null);

  const router = useRouter();
  const pathname = usePathname();
  const {
    token: { borderRadiusLG },
  } = theme.useToken();

  const selectedKey = pathname || "/creator";

  const {
    taskId,
    isRunning,
    logs,
    progress,
    done,
    exitCode,
    summary,
    clearLogs,
    cancelTask,
  } = useTaskContext();

  function openTerminal() {
    setTerminalOpen(true);
    setTerminalMinimized(false);
  }

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

  function onMouseDownResize(e: React.MouseEvent) {
    if (terminalMinimized) return;
    e.stopPropagation();
    resizeRef.current = {
      resizing: true,
      startX: e.clientX,
      startY: e.clientY,
      baseW: size.w,
      baseH: size.h,
    };

    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current?.resizing) return;
      const dx = ev.clientX - resizeRef.current.startX;
      const dy = ev.clientY - resizeRef.current.startY;
      const nextW = Math.max(420, Math.min(window.innerWidth - 24, resizeRef.current.baseW + dx));
      const nextH = Math.max(260, Math.min(window.innerHeight - 24, resizeRef.current.baseH + dy));
      setSize({ w: nextW, h: nextH });
    };

    const onUp = () => {
      if (resizeRef.current) resizeRef.current.resizing = false;
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
        width={248}
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
            justifyContent: collapsed ? "center" : "space-between",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 10,
                background:
                  "linear-gradient(135deg, rgba(59,130,246,.92), rgba(99,102,241,.75))",
                boxShadow: "0 10px 22px rgba(15, 23, 42, .10)",
              }}
            />
            {!collapsed && (
              <div style={{ lineHeight: 1.1 }}>
                <Text style={{ color: "rgba(15,23,42,.92)", fontSize: 13, fontWeight: 650 }}>
                  抖店/抖创
                </Text>
                <div className="panel-title" style={{ marginTop: 2 }}>
                  数据工具台
                </div>
              </div>
            )}
          </div>
          {!collapsed && (
            <Text style={{ color: "rgba(15,23,42,.45)", fontSize: 11 }} ellipsis>
              {new Date().toLocaleDateString("zh-CN")}
            </Text>
          )}
        </div>

        <Menu
          theme="light"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
          style={{ padding: 6, borderInlineEnd: 0 }}
        />

        <div
          style={{
            padding: collapsed ? 8 : 12,
            borderTop: "1px solid rgba(15, 23, 42, .08)",
            marginTop: 8,
          }}
        >
          <div style={{ height: 32 }} />
        </div>
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

      {/* 右下角浮动入口 */}
      {!terminalOpen && (
        <button
          type="button"
          className="terminal-float-launch"
          onClick={openTerminal}
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
                  width: size.w,
                  height: size.h,
                  transform: `translateX(-50%) translate(${pos.x}px, ${pos.y}px)`,
                }
          }
        >
          {terminalMinimized ? (
            <button
              type="button"
              className="terminal-float-minibtn"
              onClick={() => setTerminalMinimized(false)}
              aria-label="展开命令行"
              title="展开命令行"
            >
              <ConsoleSqlOutlined />
            </button>
          ) : (
            <div className="terminal-float-card">
              <div className="terminal-float-header" onMouseDown={onMouseDownDrag}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ConsoleSqlOutlined />
                  <span style={{ fontSize: 12, color: "rgba(15,23,42,.82)", fontWeight: 650 }}>
                    命令行 / 任务日志
                  </span>
                  {taskId ? (
                    <span style={{ fontSize: 11, color: "rgba(15,23,42,.45)" }}>ID: {taskId}</span>
                  ) : null}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {isRunning && !done ? (
                    <Button danger size="small" onClick={cancelTask}>
                      终止
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    icon={<MinusOutlined />}
                    onClick={() => setTerminalMinimized(true)}
                  />
                  <Button
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => {
                      setTerminalOpen(false);
                      setTerminalMinimized(false);
                    }}
                  />
                </div>
              </div>

              <div className="terminal-float-body">
                <TaskPanel
                  taskId={taskId}
                  isRunning={isRunning}
                  taskButtons={[]}
                  logs={logs}
                  progress={progress}
                  done={done}
                  exitCode={exitCode}
                  summary={summary}
                  onClearLogs={clearLogs}
                  terminalHeight={Math.max(160, size.h - 54 - 12)}
                />
              </div>

              <div
                className="terminal-float-resizer"
                onMouseDown={onMouseDownResize}
                role="presentation"
              />
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
