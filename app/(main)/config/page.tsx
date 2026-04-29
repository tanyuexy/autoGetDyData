"use client";

import { useState, useEffect, useCallback } from "react";
import { Tabs, Button, Spin, App, Switch, Space, Typography, Alert } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import ConfigAccountTab from "@/components/ConfigAccountTab";
import ConfigEmailTab from "@/components/ConfigEmailTab";
import ConfigFeishuTab from "@/components/ConfigFeishuTab";
import ConfigCreatorDatesSection from "@/components/ConfigCreatorDatesSection";
import type { ConfigData } from "@/types";

export default function ConfigPage() {
  const { message } = App.useApp();
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

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
          <ConfigAccountTab
            accounts={config.accounts || []}
            loginVerifyMethod={config.douyinCreator?.loginVerifyMethod || "qr"}
            onChange={(data) =>
              mergeChange({
                accounts: data.accounts,
                douyinCreator: {
                  loginVerifyMethod: data.loginVerifyMethod,
                },
              })
            }
          />

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
