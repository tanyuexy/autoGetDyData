import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider, App, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import "./globals.css";

export const metadata: Metadata = {
  title: "抖店/抖创后台管理",
  description: "抖音创作者 & 抖店数据抓取与飞书同步管理",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <AntdRegistry>
          <ConfigProvider
            locale={zhCN}
            theme={{
              cssVar: {},
              hashed: true,
              token: {
                colorPrimary: "#3B82F6",
                colorInfo: "#3B82F6",
                colorText: "rgba(15, 23, 42, .92)",
                colorTextSecondary: "rgba(15, 23, 42, .62)",
                colorBgBase: "#F5F7FB",
                colorBgContainer: "rgba(255,255,255,.86)",
                colorBorder: "rgba(15, 23, 42, .10)",
                borderRadius: 10,
                fontSize: 13,
                controlHeight: 32,
                lineHeight: 1.5,
              },
              algorithm: antdTheme.defaultAlgorithm,
              components: {
                Layout: {
                  headerBg: "transparent",
                  bodyBg: "transparent",
                  siderBg: "transparent",
                },
                Menu: {
                  itemBg: "transparent",
                  subMenuItemBg: "transparent",
                  itemSelectedBg: "rgba(59, 130, 246, .10)",
                  itemHoverBg: "rgba(15, 23, 42, .04)",
                  itemSelectedColor: "rgba(15, 23, 42, .92)",
                  itemColor: "rgba(15, 23, 42, .70)",
                  itemHoverColor: "rgba(15, 23, 42, .92)",
                },
                Table: {
                  headerBg: "rgba(245, 247, 251, .9)",
                  headerColor: "rgba(15, 23, 42, .70)",
                  rowHoverBg: "rgba(59, 130, 246, .05)",
                },
                Card: {
                  headerBg: "transparent",
                },
                Tabs: {
                  itemSelectedColor: "#3B82F6",
                  inkBarColor: "#3B82F6",
                },
              },
            }}
          >
            <App>{children}</App>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
