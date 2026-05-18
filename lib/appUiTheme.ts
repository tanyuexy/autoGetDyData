import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

export const APP_UI_THEME_STORAGE_KEY = "autogetdy-ui-theme";

export type AppUiTheme = "intercom" | "voltagent";

export function isAppUiTheme(value: unknown): value is AppUiTheme {
  return value === "intercom" || value === "voltagent";
}

/** intercom/DESIGN.md — 浅色奶油 + 炭灰主色 */
export function buildIntercomAntdTheme(): ThemeConfig {
  return {
    cssVar: {},
    hashed: true,
    algorithm: antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: "#111111",
      colorInfo: "#111111",
      colorLink: "#111111",
      colorLinkHover: "#454542",
      colorTextLightSolid: "#ffffff",
      colorText: "#111111",
      colorTextSecondary: "#454542",
      colorTextTertiary: "#5f5f5c",
      colorTextQuaternary: "#6f6f6c",
      colorBgBase: "#f5f1ec",
      colorBgContainer: "#ffffff",
      colorBgElevated: "#ffffff",
      colorBgLayout: "#f5f1ec",
      colorBorder: "#d3cec6",
      colorBorderSecondary: "#ebe7e1",
      borderRadius: 8,
      borderRadiusLG: 12,
      fontSize: 16,
      fontSizeSM: 14,
      fontSizeLG: 18,
      controlHeight: 40,
      lineHeight: 1.5,
      fontFamily:
        'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontFamilyCode:
        'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    },
    components: {
      Layout: {
        headerBg: "transparent",
        bodyBg: "transparent",
        siderBg: "transparent",
      },
      Menu: {
        itemBg: "transparent",
        subMenuItemBg: "transparent",
        itemSelectedBg: "rgba(17, 17, 17, 0.06)",
        itemSelectedColor: "#111111",
        itemColor: "#525252",
        itemHoverBg: "rgba(17, 17, 17, 0.04)",
        itemHoverColor: "#111111",
        fontSize: 14,
      },
      Table: {
        headerBg: "#ebe7e1",
        headerColor: "#525252",
        headerSplitColor: "#d3cec6",
        colorBgContainer: "#ffffff",
        rowHoverBg: "rgba(17, 17, 17, 0.04)",
        /** 默认跟随 controlItemBgActive（炭灰主色下偏深），选中行文字/链接对比不足 */
        rowSelectedBg: "rgba(17, 17, 17, 0.07)",
        rowSelectedHoverBg: "rgba(17, 17, 17, 0.1)",
        cellFontSizeSM: 14,
        borderColor: "#d3cec6",
      },
      Card: {
        colorBgContainer: "#ffffff",
        colorBorderSecondary: "#d3cec6",
        headerBg: "transparent",
      },
      Tabs: {
        itemSelectedColor: "#111111",
        inkBarColor: "#111111",
        itemHoverColor: "#111111",
        itemColor: "#525252",
      },
      Select: {
        colorBgElevated: "#ffffff",
        optionSelectedBg: "rgba(17, 17, 17, 0.06)",
      },
      Dropdown: {
        colorBgElevated: "#ffffff",
      },
      Tooltip: {
        colorBgSpotlight: "#313130",
      },
      Modal: {
        contentBg: "#ffffff",
        headerBg: "#ffffff",
        footerBg: "#ffffff",
        colorBorder: "#d3cec6",
      },
      Drawer: {
        colorBgElevated: "#ffffff",
      },
      Input: {
        colorBgContainer: "#ffffff",
        activeBorderColor: "#111111",
        hoverBorderColor: "#626260",
      },
      InputNumber: {
        colorBgContainer: "#ffffff",
        activeBorderColor: "#111111",
        hoverBorderColor: "#626260",
      },
      Button: {
        fontWeight: 500,
        primaryShadow: "none",
        colorPrimary: "#111111",
        colorPrimaryHover: "#000000",
        colorPrimaryActive: "#000000",
        defaultBorderColor: "#d3cec6",
        defaultColor: "#111111",
        defaultBg: "#ffffff",
        defaultHoverBorderColor: "#111111",
        defaultHoverColor: "#111111",
        defaultHoverBg: "#ffffff",
      },
      Alert: {
        colorInfo: "#111111",
        colorInfoBorder: "#d3cec6",
        colorInfoBg: "rgba(17, 17, 17, 0.04)",
      },
      Tag: {
        defaultBg: "#ebe7e1",
        defaultColor: "#111111",
      },
    },
  };
}

/** DESIGN.md (Voltagent) — 近黑画布 + 电绿强调 */
export function buildVoltagentAntdTheme(): ThemeConfig {
  return {
    cssVar: {},
    hashed: true,
    algorithm: antdTheme.darkAlgorithm,
    token: {
      colorPrimary: "#00d992",
      colorInfo: "#00d992",
      colorLink: "#10b981",
      colorTextLightSolid: "#101010",
      colorText: "#f2f2f2",
      colorTextSecondary: "#d2d2d2",
      colorTextTertiary: "#b0b8c2",
      colorTextQuaternary: "#b0b8c2",
      colorBgBase: "#101010",
      colorBgContainer: "#101010",
      colorBgElevated: "#1a1a1a",
      colorBgLayout: "#101010",
      colorBorder: "#3d3a39",
      colorBorderSecondary: "#3d3a39",
      borderRadius: 6,
      borderRadiusLG: 8,
      fontSize: 14,
      fontSizeSM: 12,
      fontSizeLG: 16,
      controlHeight: 36,
      lineHeight: 1.625,
      fontFamily:
        'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontFamilyCode:
        'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    },
    components: {
      Layout: {
        headerBg: "transparent",
        bodyBg: "transparent",
        siderBg: "transparent",
      },
      Menu: {
        itemBg: "transparent",
        subMenuItemBg: "transparent",
        darkItemBg: "transparent",
        darkSubMenuItemBg: "transparent",
        itemSelectedBg: "rgba(0, 217, 146, 0.12)",
        itemSelectedColor: "#f2f2f2",
        itemColor: "#d2d2d2",
        itemHoverBg: "rgba(255, 255, 255, 0.04)",
        itemHoverColor: "#f2f2f2",
        darkItemSelectedBg: "rgba(0, 217, 146, 0.12)",
        darkItemSelectedColor: "#f2f2f2",
        darkItemColor: "#d2d2d2",
        darkItemHoverBg: "rgba(255, 255, 255, 0.04)",
        fontSize: 14,
      },
      Table: {
        headerBg: "#1a1a1a",
        headerColor: "#b0b8c2",
        headerSplitColor: "#3d3a39",
        colorBgContainer: "#101010",
        rowHoverBg: "rgba(0, 217, 146, 0.06)",
        rowSelectedBg: "rgba(0, 217, 146, 0.14)",
        rowSelectedHoverBg: "rgba(0, 217, 146, 0.22)",
        cellFontSizeSM: 13,
        borderColor: "#3d3a39",
      },
      Card: {
        colorBgContainer: "#101010",
        colorBorderSecondary: "#3d3a39",
        headerBg: "transparent",
      },
      Tabs: {
        itemSelectedColor: "#00d992",
        inkBarColor: "#00d992",
        itemHoverColor: "#f2f2f2",
        itemColor: "#d2d2d2",
      },
      Select: {
        colorBgElevated: "#1a1a1a",
        optionSelectedBg: "rgba(0, 217, 146, 0.12)",
      },
      Dropdown: {
        colorBgElevated: "#1a1a1a",
      },
      Tooltip: {
        colorBgSpotlight: "#1a1a1a",
      },
      Modal: {
        contentBg: "#101010",
        headerBg: "#101010",
        footerBg: "#101010",
        colorBorder: "#3d3a39",
      },
      Drawer: {
        colorBgElevated: "#101010",
      },
      Input: {
        colorBgContainer: "#1a1a1a",
        activeBorderColor: "#00d992",
        hoverBorderColor: "#2fd6a1",
      },
      InputNumber: {
        colorBgContainer: "#1a1a1a",
        activeBorderColor: "#00d992",
        hoverBorderColor: "#2fd6a1",
      },
      Button: {
        fontWeight: 500,
        primaryShadow: "none",
        colorPrimary: "#00d992",
        colorPrimaryHover: "#2fd6a1",
        colorPrimaryActive: "#10b981",
        defaultBorderColor: "#3d3a39",
        defaultColor: "#f2f2f2",
        defaultBg: "#101010",
        defaultHoverBorderColor: "#5c5856",
        defaultHoverColor: "#f2f2f2",
        defaultHoverBg: "#101010",
      },
      Alert: {
        colorInfo: "#00d992",
        colorInfoBorder: "#3d3a39",
        colorInfoBg: "rgba(0, 217, 146, 0.08)",
      },
      Tag: {
        defaultBg: "#1a1a1a",
        defaultColor: "#f2f2f2",
      },
    },
  };
}
