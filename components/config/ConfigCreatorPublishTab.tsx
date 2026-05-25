import {
  Alert,
  Button,
  Checkbox,
  InputNumber,
  Select,
  Space,
  Switch,
  Tabs,
  Typography,
} from "antd";
import SettingSection from "@/components/layout/SettingSection";
import {
  FEISHU_AI_CONTENT_MAX_CONCURRENT_HARD_MAX,
  normalizeFeishuAiContentMaxConcurrent,
} from "@/lib/feishuAiContentConcurrency";
import { FEISHU_AI_PROVIDER_OPTIONS, normalizeFeishuAiProvider } from "@/lib/feishuAiProvider";
import {
  PUBLISH_MAX_CONCURRENT_HARD_MAX,
  normalizePublishMaxConcurrent,
} from "@/lib/publishConcurrency";
import {
  getAutomationSelectedDays,
  normalizeTimeTags,
  WEEKDAY_OPTIONS,
  type CreatorPublishConfig,
} from "@/lib/creatorPublishConfig";

type ConfigCreatorPublishTabProps = {
  publishConfig: CreatorPublishConfig;
  onSave: (patch: { creatorPublish: CreatorPublishConfig }) => void;
};

export function ConfigCreatorPublishTab({ publishConfig, onSave }: ConfigCreatorPublishTabProps) {
  const autoSave = (next: CreatorPublishConfig) => onSave({ creatorPublish: next });

  return (
    <>
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
                  ...publishConfig,
                  publishEnabled: v,
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
                    ...publishConfig,
                    publishWaitSec: v || 3,
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
                    ...publishConfig,
                    publishMaxConcurrent:
                      v == null || !Number.isFinite(Number(v))
                        ? normalizePublishMaxConcurrent(undefined)
                        : normalizePublishMaxConcurrent(Number(v)),
                  })
                }
                style={{ width: 92 }}
              />
              <Button disabled>个</Button>
            </Space.Compact>
          </Space>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-start",
              justifyContent: "flex-start",
              gap: 16,
              width: "100%",
            }}
          >
            <Space align="center" size={16}>
              <Space orientation="vertical" size={0}>
                <Typography.Text strong>飞书 AI 正文模型</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  「AI生成正文」按钮使用；写入 app_config
                </Typography.Text>
              </Space>
              <Select
                value={publishConfig.feishuAiProvider ?? "minimax"}
                onChange={(value) =>
                  autoSave({
                    ...publishConfig,
                    feishuAiProvider: normalizeFeishuAiProvider(value),
                  })
                }
                style={{ width: 160 }}
                options={FEISHU_AI_PROVIDER_OPTIONS}
              />
            </Space>

            <Space align="center" size={16}>
              <Space orientation="vertical" size={0}>
                <Typography.Text strong>飞书 AI 正文并发数</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  同时向 LLM 发起多少条正文生成请求；仅「AI生成正文」使用
                </Typography.Text>
              </Space>
              <Space.Compact>
                <InputNumber
                  min={1}
                  max={FEISHU_AI_CONTENT_MAX_CONCURRENT_HARD_MAX}
                  value={normalizeFeishuAiContentMaxConcurrent(
                    publishConfig.feishuAiContentMaxConcurrent
                  )}
                  onChange={(v) =>
                    autoSave({
                      ...publishConfig,
                      feishuAiContentMaxConcurrent:
                        v == null || !Number.isFinite(Number(v))
                          ? normalizeFeishuAiContentMaxConcurrent(undefined)
                          : normalizeFeishuAiContentMaxConcurrent(Number(v)),
                    })
                  }
                  style={{ width: 92 }}
                />
                <Button disabled>个</Button>
              </Space.Compact>
            </Space>
          </div>
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
                  ...publishConfig,
                  automation: {
                    ...publishConfig.automation,
                    enabled: checked,
                  },
                })
              }
            />
            <Space orientation="vertical" size={0}>
              <Typography.Text strong>启用自动从飞书导入并执行任务</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                到达设定时间后自动“从飞书导入任务”，新导入任务会直接进入执行队列（正文需先在飞书填写或单独点「AI生成正文」）
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
                          ...publishConfig,
                          automation: {
                            ...publishConfig.automation,
                            weekly: {
                              ...publishConfig.automation?.weekly,
                              times: normalizeTimeTags(values as string[]),
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
                          ...publishConfig,
                          automation: {
                            ...publishConfig.automation,
                            interval: {
                              ...publishConfig.automation?.interval,
                              everyMinutes: Number(value) || 60,
                              anchorAt: new Date().toISOString(),
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
    </>
  );
}
