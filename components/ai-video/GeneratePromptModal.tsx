"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Modal, Radio, Space, Tag, Typography } from "antd";
import { ReferenceTokenTextArea } from "@/components/ai-video/ReferenceTokenTextArea";
import { normalizePromptWhitespace } from "@/lib/ai-video/promptFormat";
import type { GenerationMode, ReferenceResource } from "@/lib/ai-video/types";
import { antdTagPresetStyle } from "@/lib/semanticTagStyles";

export interface SeedancePromptVersion {
  title: string;
  prompt: string;
  note?: string;
}

export interface GeneratePromptModalProps {
  open: boolean;
  loading: boolean;
  hasMiniMaxApiKey: boolean;
  llmModel?: string;
  mode: GenerationMode;
  duration: number;
  ratio: string;
  resolution: string;
  referenceResources: ReferenceResource[];
  existingPrompt: string;
  versions: SeedancePromptVersion[];
  onCancel: () => void;
  onGenerate: (input: { brief: string; stylePreference?: string }) => void | Promise<void>;
  onApply: (prompt: string) => void;
}

function modeLabel(mode: GenerationMode) {
  if (mode === "text") return "文生视频";
  if (mode === "first-last-frame") return "首尾帧";
  if (mode === "multimodal-reference") return "多模态参考";
  return "首帧";
}

export function GeneratePromptModal({
  open,
  loading,
  hasMiniMaxApiKey,
  llmModel,
  mode,
  duration,
  ratio,
  resolution,
  referenceResources,
  existingPrompt,
  versions,
  onCancel,
  onGenerate,
  onApply,
}: GeneratePromptModalProps) {
  const [brief, setBrief] = useState("");
  const [stylePreference, setStylePreference] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setBrief(existingPrompt.trim());
    setStylePreference("");
    setSelectedIndex(0);
  }, [existingPrompt, open]);

  useEffect(() => {
    if (selectedIndex >= versions.length) {
      setSelectedIndex(0);
    }
  }, [selectedIndex, versions.length]);

  const selectedVersion = versions[selectedIndex];

  const contextTags = useMemo(
    () => [
      modeLabel(mode),
      `${duration} 秒`,
      ratio,
      resolution,
      referenceResources.length ? `${referenceResources.length} 个参考素材` : "无参考素材",
    ],
    [duration, mode, ratio, resolution, referenceResources.length]
  );

  return (
    <Modal
      title="AI 生成 Seedance 提示词"
      open={open}
      onCancel={onCancel}
      width={760}
      destroyOnHidden
      footer={
        <Space wrap>
          <Button onClick={onCancel}>关闭</Button>
          <Button loading={loading} onClick={() => void onGenerate({ brief, stylePreference })}>
            {versions.length ? "重新生成" : "生成提示词"}
          </Button>
          <Button
            type="primary"
            disabled={!selectedVersion}
            onClick={() => selectedVersion && onApply(selectedVersion.prompt)}
          >
            使用选中版本
          </Button>
        </Space>
      }
    >
      <Space orientation="vertical" size={14} style={{ width: "100%" }}>
        {!hasMiniMaxApiKey ? (
          <Alert
            type="warning"
            showIcon
            title="请先在服务端环境变量中配置 MINIMAX_API_KEY，才能使用 AI 生成提示词"
          />
        ) : null}

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          基于 seedance-prompt-skill 规则，由 MiniMax{llmModel ? `（${llmModel}）` : ""} 生成可直接用于即梦 Seedance 2.0 的中文提示词。
        </Typography.Text>

        <Space wrap size={6}>
          {contextTags.map((tag) => (
            <Tag key={tag} style={antdTagPresetStyle("blue")}>
              {tag}
            </Tag>
          ))}
        </Space>

        <Space orientation="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Text strong>视频创意 / 主题（可选）</Typography.Text>
          <ReferenceTokenTextArea
            value={brief}
            onChange={setBrief}
            referenceResources={referenceResources}
            idPrefix="generate-prompt-picker"
            placeholder="可留空让 AI 先理解图片后自主生成创意；视频素材请在这里说明希望参考的动作节奏或内容"
            autoSize={{ minRows: 3, maxRows: 6 }}
            maxLength={800}
          />
        </Space>

        <Space orientation="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Text strong>风格偏好（可选）</Typography.Text>
          <Input
            value={stylePreference}
            onChange={(event) => setStylePreference(event.target.value)}
            placeholder="例如：仿实拍 / 手机手持 UGC、自然光低饱和、电影感、赛博朋克、广告大片、一镜到底"
            maxLength={200}
          />
        </Space>

        {versions.length ? (
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            <Typography.Text strong>生成结果（{versions.length} 个版本）</Typography.Text>
            <Radio.Group
              value={selectedIndex}
              onChange={(event) => setSelectedIndex(event.target.value)}
              style={{ width: "100%" }}
            >
              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                {versions.map((version, index) => (
                  <Radio
                    key={`${version.title}-${index}`}
                    value={index}
                    style={{ alignItems: "flex-start", width: "100%", marginInlineEnd: 0 }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text strong style={{ display: "block" }}>
                        {version.title}
                      </Typography.Text>
                      {version.note ? (
                        <Typography.Text
                          type="secondary"
                          style={{ display: "block", fontSize: 12, marginTop: 2 }}
                        >
                          {version.note}
                        </Typography.Text>
                      ) : null}
                      <Typography.Text
                        type="secondary"
                        style={{
                          display: "block",
                          marginTop: 4,
                          fontSize: 12,
                          lineHeight: 1.55,
                          whiteSpace: "pre-line",
                        }}
                      >
                        {normalizePromptWhitespace(version.prompt)}
                      </Typography.Text>
                    </div>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Space>
        ) : null}
      </Space>
    </Modal>
  );
}
