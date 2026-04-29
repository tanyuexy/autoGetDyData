"use client";

import { useState } from "react";
import { Layout, Menu, theme, Typography } from "antd";
import {
  VideoCameraOutlined,
  ShoppingOutlined,
  CloudOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useRouter, usePathname } from "next/navigation";

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const selectedKey = "/" + (pathname?.split("/")[1] || "creator");

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="dark"
      >
        <div
          style={{
            height: 36,
            margin: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{ color: "#fff", fontSize: collapsed ? 14 : 16, fontWeight: 600 }}
            ellipsis
          >
            {collapsed ? "抖" : "抖店/抖创后台管理"}
          </Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: "0 16px",
            height: 48,
            background: colorBgContainer,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <Text strong style={{ fontSize: 14 }}>
            {
              menuItems.find((m) => m.key === selectedKey)?.label || "抖店/抖创数据工具"
            }
          </Text>
        </Header>
        <Content
          style={{
            margin: 12,
            padding: 16,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
            minHeight: 200,
            overflow: "auto",
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
