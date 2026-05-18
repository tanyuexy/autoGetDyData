"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Tabs, Button, Spin, App, Switch, Space, Typography, Alert, Divider, InputNumber, Checkbox, Select } from "antd";
import ConfigEmailTab from "@/components/ConfigEmailTab";
import ConfigFeishuTab from "@/components/ConfigFeishuTab";
import ConfigCreatorDatesSection from "@/components/ConfigCreatorDatesSection";
import AccountTable from "@/components/AccountTable";
import { useTaskContext } from "@/contexts/TaskContext";
import type { ConfigData, CreatorAccount } from "@/types";
import {
  normalizePublishMaxConcurrent,
  PUBLISH_MAX_CONCURRENT_DEFAULT,
  PUBLISH_MAX_CONCURRENT_HARD_MAX,
} from "@/lib/publishConcurrency";

type CreatorPublishConfig = NonNullable<ConfigData["creatorPublish"]>;

const DEFAULT_CREATOR_PUBLISH_CONFIG: CreatorPublishConfig = {
  publishEnabled: true,
  publishWaitSec: 3,
  publishMaxConcurrent: PUBLISH_MAX_CONCURRENT_DEFAULT,
  automation: {
    enabled: false,
    mode: "weekly",
    weekly: {
      days: [1, 2, 3, 4, 5],
      times: ["09:00"],
    },
    interval: {
      days: [1, 2, 3, 4, 5],
      everyMinutes: 60,
      anchorAt: null,
    },
  },
};

const WEEKDAY_OPTIONS = [
  { label: "周一", value: 1 },
  { label: "周二", value: 2 },
  { label: "周三", value: 3 },
  { label: "周四", value: 4 },
  { label: "周五", value: 5 },
  { label: "周六", value: 6 },
  { label: "周日", value: 0 },
];

function normalizeTimeTags(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter((item) => /^\d{2}:\d{2}$/.test(item))
    )
  ).sort();
}

function normalizeCreatorPublishConfig(input?: Partial<CreatorPublishConfig> | null): CreatorPublishConfig {
  return {
    publishEnabled: input?.publishEnabled ?? DEFAULT_CREATOR_PUBLISH_CONFIG.publishEnabled,
    publishWaitSec: input?.publishWaitSec ?? DEFAULT_CREATOR_PUBLISH_CONFIG.publishWaitSec,
    publishMaxConcurrent: normalizePublishMaxConcurrent(
      input?.publishMaxConcurrent ?? DEFAULT_CREATOR_PUBLISH_CONFIG.publishMaxConcurrent
    ),
    automation: {
      enabled: input?.automation?.enabled ?? DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.enabled,
      mode: input?.automation?.mode ?? DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.mode,
      weekly: {
        days: input?.automation?.weekly?.days ?? DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.weekly!.days,
        times: normalizeTimeTags(
          input?.automation?.weekly?.times ?? DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.weekly!.times!
        ),
      },
      interval: {
        days: input?.automation?.interval?.days ?? DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.interval!.days,
        everyMinutes:
          input?.automation?.interval?.everyMinutes ??
          DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.interval!.everyMinutes,
        anchorAt:
          input?.automation?.interval?.anchorAt ??
          DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.interval!.anchorAt,
      },
    },
  };
}

function getAutomationSelectedDays(config: CreatorPublishConfig): number[] {
  const mode = config.automation?.mode ?? "weekly";
  return mode === "interval"
    ? config.automation?.interval?.days ?? []
    : config.automation?.weekly?.days ?? [];
}

const sectionStyle: React.CSSProperties = {
  border: "1px solid var(--vol-hairline)",
  borderRadius: 8,
  background: "var(--vol-canvas-soft)",
  padding: 16,
};

const pageWrapStyle: React.CSSProperties = {
  maxWidth: 1180,
};

function SettingSection(props: {
  title: string;
  description?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={sectionStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <Typography.Text strong style={{ fontSize: 15 }}>
            {props.title}
          </Typography.Text>
          {props.description ? (
            <div style={{ marginTop: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {props.description}
              </Typography.Text>
            </div>
          ) : null}
        </div>
        {props.extra}
      </div>
      {props.children}
    </section>
  );
}

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

  useEffect(() => {
    const loginTaskRunning = runningTasks.some((task) => task.namespace === "login");
    if (loginTaskWasRunningRef.current && !loginTaskRunning) {
      fetchCreatorAccounts();
      setShopLoginRefreshKey((value) => value + 1);
    }
    loginTaskWasRunningRef.current = loginTaskRunning;
  }, [runningTasks, fetchCreatorAccounts]);

  // Keep ref in sync for debounced saves
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Cleanup debounce timer on unmount
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

          <SettingSection
            title="发布行为"
            description="控制发布并发、是否点击提交，以及发布后页面停留时长。"
          >
            <Space orientation="vertical" size={16} style={{ width: "100%" }}>
              <Space align="start" size={12}>
                <Switch
                  checked={publishConfig.publishEnabled ?? true}
                  onChange={(v) =>
                    autoSave({
                      creatorPublish: {
                        ...publishConfig,
                        publishEnabled: v,
                      },
                    })
                  }
                />
                <Space orientation="vertical" size={0}>
                  <Typography.Text strong>点击发布按钮</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    开启后发布流程会自动点击发布按钮；关闭后仅填写表单不发布
                  </Typography.Text>
                </Space>
              </Space>

              <Space align="center" size={16}>
                <Space orientation="vertical" size={0}>
                  <Typography.Text strong>停留秒数</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    发布或填表完成后在页面停留的秒数
                  </Typography.Text>
                </Space>
                <Space.Compact>
                  <InputNumber
                    min={1}
                    max={Infinity}
                    value={publishConfig.publishWaitSec ?? 3}
                    onChange={(v) =>
                      autoSave({
                        creatorPublish: {
                          ...publishConfig,
                          publishWaitSec: v || 3,
                        },
                      })
                    }
                    style={{ width: 92 }}
                  />
                  <Button disabled>秒</Button>
                </Space.Compact>
              </Space>

              <Space align="center" size={16}>
                <Space orientation="vertical" size={0}>
                  <Typography.Text strong>发布并发进程数</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    同时拉起多少个浏览器跑发布脚本（前台与后台 Worker 共用）。调高易占满内存。
                  </Typography.Text>
                </Space>
                <Space.Compact>
                  <InputNumber
                    min={1}
                    max={PUBLISH_MAX_CONCURRENT_HARD_MAX}
                    value={normalizePublishMaxConcurrent(publishConfig.publishMaxConcurrent)}
                    onChange={(v) =>
                      autoSave({
                        creatorPublish: {
                          ...publishConfig,
                          publishMaxConcurrent:
                            v == null || !Number.isFinite(Number(v))
                              ? normalizePublishMaxConcurrent(undefined)
                              : normalizePublishMaxConcurrent(Number(v)),
                        },
                      })
                    }
                    style={{ width: 92 }}
                  />
                  <Button disabled>个</Button>
                </Space.Compact>
              </Space>
            </Space>
          </SettingSection>

          <SettingSection
            title="自动调度"
            description="定时从飞书任务表导入内容，并让新导入任务直接进入发布执行队列。"
          >
            <Space orientation="vertical" size={16} style={{ width: "100%" }}>
              <Space align="start" size={12}>
                <Switch
                  checked={publishConfig.automation?.enabled ?? false}
                  onChange={(checked) =>
                    autoSave({
                      creatorPublish: {
                        ...publishConfig,
                        automation: {
                          ...publishConfig.automation,
                          enabled: checked,
                        },
                      },
                    })
                  }
                />
                <Space orientation="vertical" size={0}>
                  <Typography.Text strong>启用自动从飞书导入并执行任务</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    到达设定时间后自动运行“从飞书导入任务”，新导入任务会直接进入执行队列
                  </Typography.Text>
                </Space>
              </Space>

              <div>
                <Typography.Text strong>执行日期</Typography.Text>
                <div style={{ marginTop: 8 }}>
                  <Checkbox.Group
                    options={WEEKDAY_OPTIONS}
                    value={getAutomationSelectedDays(publishConfig)}
                    onChange={(days) =>
                      autoSave({
                        creatorPublish: {
                          ...publishConfig,
                          automation: {
                            ...publishConfig.automation,
                            ...(publishConfig.automation?.mode === "interval"
                              ? {
                                  interval: {
                                    ...publishConfig.automation?.interval,
                                    days: days as number[],
                                  },
                                }
                              : {
                                  weekly: {
                                    ...publishConfig.automation?.weekly,
                                    days: days as number[],
                                  },
                                }),
                          },
                        },
                      })
                    }
                  />
                </div>
              </div>

              <Tabs
                size="small"
                activeKey={publishConfig.automation?.mode ?? "weekly"}
                onChange={(key) =>
                  autoSave({
                    creatorPublish: {
                      ...publishConfig,
                      automation: {
                        ...publishConfig.automation,
                        mode: key as "weekly" | "interval",
                        interval: {
                          ...publishConfig.automation?.interval,
                          anchorAt:
                            key === "interval"
                              ? new Date().toISOString()
                              : publishConfig.automation?.interval?.anchorAt ?? null,
                        },
                      },
                    },
                  })
                }
                items={[
                  {
                    key: "weekly",
                    label: "固定时间",
                    children: (
                      <div style={{ paddingTop: 4 }}>
                        <Typography.Text strong>执行时间</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                          输入 `09:00` 后回车，可添加多个时间
                        </Typography.Text>
                        <Select
                          mode="tags"
                          value={publishConfig.automation?.weekly?.times ?? []}
                          onChange={(values) =>
                            autoSave({
                              creatorPublish: {
                                ...publishConfig,
                                automation: {
                                  ...publishConfig.automation,
                                  weekly: {
                                    ...publishConfig.automation?.weekly,
                                    times: normalizeTimeTags(values as string[]),
                                  },
                                },
                              },
                            })
                          }
                          tokenSeparators={[",", " "]}
                          placeholder="例如 09:00、14:30"
                          style={{ width: "100%", marginTop: 8 }}
                        />
                      </div>
                    ),
                  },
                  {
                    key: "interval",
                    label: "执行间隔",
                    children: (
                      <Space align="center" size={12} style={{ paddingTop: 4 }}>
                        <Typography.Text strong>在选定日期里，每隔</Typography.Text>
                        <InputNumber
                          min={1}
                          max={10080}
                          value={publishConfig.automation?.interval?.everyMinutes ?? 60}
                          onChange={(value) =>
                            autoSave({
                              creatorPublish: {
                                ...publishConfig,
                                automation: {
                                  ...publishConfig.automation,
                                  interval: {
                                    ...publishConfig.automation?.interval,
                                    everyMinutes: Number(value) || 60,
                                    anchorAt: new Date().toISOString(),
                                  },
                                },
                              },
                            })
                          }
                          style={{ width: 100 }}
                        />
                        <Typography.Text>分钟自动导入并执行一次</Typography.Text>
                      </Space>
                    ),
                  },
                ]}
              />

              <Alert
                type="info"
                showIcon
                title="自动调度使用服务器当前时间触发；固定时间按设定时刻运行，执行间隔只会在你选中的星期几里按分钟间隔触发。"
              />
            </Space>
          </SettingSection>
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
              } catch (e: any) {
                message.error(e.message || "启动登录失败");
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
    <div style={pageWrapStyle}>
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
