"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Tabs, Spin, App, Switch, Space, Typography, Alert } from "antd";
import ConfigEmailTab from "@/components/ConfigEmailTab";
import ConfigFeishuTab from "@/components/ConfigFeishuTab";
import ConfigCreatorDatesSection from "@/components/ConfigCreatorDatesSection";
import AccountTable from "@/components/AccountTable";
import { ConfigCreatorPublishTab } from "@/components/config/ConfigCreatorPublishTab";
import SettingSection from "@/components/layout/SettingSection";
import { useTaskContext } from "@/contexts/TaskContext";
import type { ConfigData, CreatorAccount } from "@/types";
import { normalizeCreatorPublishConfig } from "@/lib/creatorPublishConfig";
import { configPageWrapStyle } from "@/lib/pageStyles";

export default function ConfigPage() {
  const { message } = App.useApp();
  const { startTask, runningTasks } = useTaskContext();
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);

  const [creatorAccounts, setCreatorAccounts] = useState<CreatorAccount[]>([]);
  const [loadingCreatorAccounts, setLoadingCreatorAccounts] = useState(false);
  const [shopLoginRefreshKey, setShopLoginRefreshKey] = useState(0);

  const configRef = useRef<ConfigData | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const loginTaskWasRunningRef = useRef(false);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch {
      message.error("加载配置失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  const fetchCreatorAccounts = useCallback(async () => {
    setLoadingCreatorAccounts(true);
    try {
      const res = await fetch("/api/creator/list", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setCreatorAccounts(data.accounts || []);
      }
    } catch {
      message.error("获取抖创账号状态失败");
    }
    setLoadingCreatorAccounts(false);
  }, [message]);

  useEffect(() => {
    fetchConfig();
    fetchCreatorAccounts();
  }, [fetchConfig, fetchCreatorAccounts]);

  useEffect(() => {
    const loginTaskRunning = runningTasks.some((task) => task.namespace === "login");
    if (loginTaskWasRunningRef.current && !loginTaskRunning) {
      fetchCreatorAccounts();
      setShopLoginRefreshKey((value) => value + 1);
    }
    loginTaskWasRunningRef.current = loginTaskRunning;
  }, [runningTasks, fetchCreatorAccounts]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  function autoSave(patch: Partial<ConfigData>) {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      configRef.current = next;
      return next;
    });

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!configRef.current) return;
      try {
        const res = await fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(configRef.current),
        });
        if (!res.ok) {
          message.error("保存失败");
        } else {
          fetchCreatorAccounts();
        }
      } catch {
        message.error("保存失败");
      }
    }, 300);
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!config) return null;

  const publishConfig = normalizeCreatorPublishConfig(config.creatorPublish);

  const tabItems = [
    {
      key: "general",
      label: "设置",
      children: (
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <SettingSection
            title="抖创账号"
            description="统一管理创作者账号、登录状态，以及快速打开创作者中心。"
          >
            <div style={{ marginTop: 2 }}>
              <AccountTable
                type="creator"
                accounts={creatorAccounts}
                loading={loadingCreatorAccounts}
                onRefresh={fetchCreatorAccounts}
                centerHeader
                onAddAccount={async (name) => {
                  if ((config.accounts || []).includes(name)) {
                    message.warning("账号已存在");
                    return;
                  }
                  const nextAccounts = [...(config.accounts || []), name];
                  const res = await fetch("/api/config", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...config, accounts: nextAccounts }),
                  });
                  if (res.ok) {
                    message.success(`已添加账号: ${name}`);
                    setConfig((prev) => (prev ? { ...prev, accounts: nextAccounts } : prev));
                    await fetchCreatorAccounts();
                  } else {
                    message.error("添加失败");
                  }
                }}
                onDeleteAccount={async (name) => {
                  const nextAccounts = (config.accounts || []).filter((a) => a !== name);
                  const res = await fetch("/api/config", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...config, accounts: nextAccounts }),
                  });
                  if (res.ok) {
                    message.success(`已删除账号: ${name}`);
                    setConfig((prev) => (prev ? { ...prev, accounts: nextAccounts } : prev));
                    await fetchCreatorAccounts();
                  } else {
                    message.error("删除失败");
                  }
                }}
                onLogin={async (name, mode) => {
                  try {
                    await startTask("/api/creator/login", { accountName: name, mode }, "login");
                    message.info(`登录任务已启动: ${name}`);
                  } catch (e: unknown) {
                    message.error(e instanceof Error ? e.message : "启动登录失败");
                  }
                }}
                onOpenCreator={async (name) => {
                  try {
                    await startTask("/api/creator/open", { accountName: name }, "system");
                    message.info(`已打开抖音创作者中心: ${name}`);
                  } catch (e: unknown) {
                    message.error(e instanceof Error ? e.message : "打开失败");
                  }
                }}
              />
            </div>
          </SettingSection>

          <SettingSection
            title="运行环境"
            description="控制浏览器是否显示窗口。这个设置会影响登录、抓取、发布等所有浏览器任务。"
          >
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <Space align="start" size={12}>
                <Switch
                  checked={config.headless ?? false}
                  onChange={(v) => autoSave({ headless: v })}
                />
                <Space orientation="vertical" size={0}>
                  <Typography.Text strong>无头模式 (Headless)</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    开启后浏览器在后台运行不显示窗口，登录二维码通过邮件发送；关闭则显示浏览器窗口
                  </Typography.Text>
                </Space>
              </Space>
              <Alert
                type="info"
                title={
                  <Typography.Text style={{ fontSize: 12 }}>
                    环境变量 <code>HEADLESS=true</code> 优先级高于此设置。重启 Web 服务后生效。
                  </Typography.Text>
                }
              />
            </Space>
          </SettingSection>
        </Space>
      ),
    },
    {
      key: "creator",
      label: "抖创设置",
      children: (
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <SettingSection
            title="导出日期"
            description="设置每个抖创账号的导出起始日期，方便批量导出时自动带上各自的日期范围。"
          >
            <ConfigCreatorDatesSection
              accounts={config.accounts || []}
              dateMap={config.creatorExportDateStartByAccount || {}}
              globalDate={config.creatorExportDateStart || null}
              onChange={(dateMap, globalDate) =>
                autoSave({
                  creatorExportDateStartByAccount: dateMap,
                  creatorExportDateStart: globalDate,
                })
              }
            />
          </SettingSection>

          <ConfigCreatorPublishTab
            publishConfig={publishConfig}
            onSave={(patch) => autoSave(patch)}
          />
        </Space>
      ),
    },
    {
      key: "shop",
      label: "抖店设置",
      children: (
        <SettingSection
          title="抖店账号"
          description="管理抖店登录邮箱、密码和登录入口，用于后续导出和同步任务。"
        >
          <ConfigEmailTab
            emails={config.emails || []}
            refreshKey={shopLoginRefreshKey}
            onChange={(emails) => autoSave({ emails })}
            onLogin={async (email) => {
              try {
                await startTask("/api/shop/login-one", { email }, "login");
                message.info(`登录任务已启动: ${email}`);
              } catch (e: unknown) {
                message.error(e instanceof Error ? e.message : "启动登录失败");
              }
            }}
          />
        </SettingSection>
      ),
    },
    {
      key: "feishu",
      label: "飞书设置",
      children: (
        <SettingSection
          title="飞书多维表格"
          description="分别配置抖店、抖创、任务、商品信息和店铺信息表的链接、App Token 与 Table ID。"
        >
          <ConfigFeishuTab
            shop={config.feishu.shop}
            creator={config.feishu.creator}
            task={config.feishu.task}
            product={config.feishu.product}
            shopInfo={config.feishu.shopInfo}
            onChange={(data) => autoSave({ feishu: data })}
          />
        </SettingSection>
      ),
    },
  ];

  return (
    <div className="app-page-scroll" style={configPageWrapStyle}>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          配置管理
        </Typography.Title>
        <Typography.Text type="secondary">
          这里集中维护账号、浏览器运行方式、发布策略和飞书表配置。
        </Typography.Text>
      </div>
      <Tabs
        items={tabItems}
        size="small"
        style={{
          background: "var(--vol-canvas-soft)",
          border: "1px solid var(--vol-hairline)",
          borderRadius: 8,
          padding: "4px 14px 16px",
        }}
      />
    </div>
  );
}
