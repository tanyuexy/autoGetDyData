"use client";

import { useState, useEffect, useCallback } from "react";
import { Tabs, Button, Spin, App, Switch, Space, Typography, Alert, Divider, InputNumber } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import ConfigEmailTab from "@/components/ConfigEmailTab";
import ConfigFeishuTab from "@/components/ConfigFeishuTab";
import ConfigCreatorDatesSection from "@/components/ConfigCreatorDatesSection";
import AccountTable from "@/components/AccountTable";
import { useTaskContext } from "@/contexts/TaskContext";
import type { ConfigData, CreatorAccount } from "@/types";

export default function ConfigPage() {
  const { message } = App.useApp();
  const { startTask } = useTaskContext();
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [creatorAccounts, setCreatorAccounts] = useState<CreatorAccount[]>([]);
  const [loadingCreatorAccounts, setLoadingCreatorAccounts] = useState(false);

  // Track dirty changes per tab
  const [dirty, setDirty] = useState<Partial<Record<string, any>>>({});

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (e) {
      message.error("加载配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

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
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchCreatorAccounts();
  }, [fetchConfig, fetchCreatorAccounts]);

  async function handleSave() {
    if (!config || !Object.keys(dirty).length) return;
    setSaving(true);
    try {
      const merged: ConfigData = { ...config, ...dirty };
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      });
      if (res.ok) {
        message.success("保存成功");
        setConfig(merged);
        setDirty({});
        await fetchCreatorAccounts();
      } else {
        message.error("保存失败");
      }
    } catch {
      message.error("保存失败");
    }
    setSaving(false);
  }

  function mergeChange(patch: Partial<ConfigData>) {
    // Apply patch to cached config and mark dirty
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty((prev) => ({ ...prev, ...patch }));
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!config) return null;

  const tabItems = [
    {
      key: "general",
      label: "设置",
      children: (
        <Space orientation="vertical" size="small" style={{ width: "100%" }}>
            <div style={{ marginTop: 8 }}>
              <AccountTable
                type="creator"
                accounts={creatorAccounts}
                loading={loadingCreatorAccounts}
                onRefresh={fetchCreatorAccounts}
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
                    setConfig((prev) => prev ? { ...prev, accounts: nextAccounts } : prev);
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
                    setConfig((prev) => prev ? { ...prev, accounts: nextAccounts } : prev);
                    await fetchCreatorAccounts();
                  } else {
                    message.error("删除失败");
                  }
                }}
                onLogin={async (name, mode) => {
                  try {
                    await startTask("/api/creator/login", { accountName: name, mode }, "login");
                    message.info(`登录任务已启动: ${name}`);
                  } catch (e: any) {
                    message.error(e.message || "启动登录失败");
                  }
                }}
                onOpenCreator={async (name) => {
                  try {
                    await startTask("/api/creator/open", { accountName: name }, "system");
                    message.info(`已打开抖音创作者中心: ${name}`);
                  } catch (e: any) {
                    message.error(e.message || "打开失败");
                  }
                }}
              />
            </div>

          <Divider style={{ margin: "8px 0" }} />

          <Space>
            <Switch
              checked={config.headless ?? false}
              onChange={(v) => mergeChange({ headless: v })}
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
      ),
    },
    {
      key: "creator",
      label: "抖创设置",
      children: (
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <ConfigCreatorDatesSection
            accounts={config.accounts || []}
            dateMap={config.creatorExportDateStartByAccount || {}}
            globalDate={config.creatorExportDateStart || null}
            onChange={(dateMap, globalDate) =>
              mergeChange({
                creatorExportDateStartByAccount: dateMap,
                creatorExportDateStart: globalDate,
              })
            }
          />

          <Divider style={{ margin: "4px 0" }} />

          <Typography.Text strong>发布设置</Typography.Text>

          <Space>
            <Switch
              checked={config.creatorPublish?.publishEnabled ?? true}
              onChange={(v) =>
                mergeChange({ creatorPublish: { ...config.creatorPublish, publishEnabled: v, publishWaitSec: config.creatorPublish?.publishWaitSec ?? 3 } })
              }
            />
            <Space orientation="vertical" size={0}>
              <Typography.Text>点击发布按钮</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                开启后发布流程会自动点击发布按钮；关闭后仅填写表单不发布
              </Typography.Text>
            </Space>
          </Space>

          <Space>
            <Space orientation="vertical" size={0}>
              <Typography.Text>停留秒数</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                发布（或不发布）后在页面停留的秒数
              </Typography.Text>
            </Space>
            <Space.Compact>
              <InputNumber
                min={1}
                max={Infinity}
                value={config.creatorPublish?.publishWaitSec ?? 3}
                onChange={(v) =>
                  mergeChange({ creatorPublish: { ...config.creatorPublish, publishEnabled: config.creatorPublish?.publishEnabled ?? true, publishWaitSec: v || 3 } })
                }
                style={{ width: 80 }}
              />
              <Button disabled>秒</Button>
            </Space.Compact>
          </Space>
        </Space>
      ),
    },
    {
      key: "shop",
      label: "抖店设置",
      children: (
        <ConfigEmailTab
          emails={config.emails || []}
          onChange={(emails) => mergeChange({ emails })}
          onLogin={async (email) => {
            try {
              await startTask("/api/shop/login-one", { email }, "login");
              message.info(`登录任务已启动: ${email}`);
            } catch (e: any) {
              message.error(e.message || "启动登录失败");
            }
          }}
        />
      ),
    },
    {
      key: "feishu",
      label: "飞书设置",
      children: (
        <ConfigFeishuTab
          shop={config.feishu.shop}
          creator={config.feishu.creator}
          task={config.feishu.task}
          onChange={(data) => mergeChange({ feishu: data })}
        />
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>配置管理</h2>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          disabled={!Object.keys(dirty).length}
        >
          保存更改
        </Button>
      </div>
      <Tabs items={tabItems} />
    </div>
  );
}
