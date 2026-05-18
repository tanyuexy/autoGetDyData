import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import "./globals.css";
import { AppThemeProvider } from "@/contexts/UIThemeContext";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "抖店/抖创后台管理",
  description: "抖音创作者 & 抖店数据抓取与飞书同步管理",
};

/** 在 React 注水前同步 data-ui-theme，避免奶油/深色背景闪烁 */
const APP_UI_THEME_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  "autogetdy-ui-theme"
)};var t=localStorage.getItem(k);if(t!=="voltagent"&&t!=="intercom")t="intercom";document.documentElement.setAttribute("data-ui-theme",t);}catch(e){document.documentElement.setAttribute("data-ui-theme","intercom");}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" data-ui-theme="intercom" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APP_UI_THEME_BOOT_SCRIPT }} />
      </head>
      <body className={inter.className}>
        <AntdRegistry>
          <AppThemeProvider>{children}</AppThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
