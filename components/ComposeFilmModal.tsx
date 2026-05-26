"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import type { AiVideoClip } from "@/types";
import { collectClipTags, filterClipsByTag } from "@/lib/ai-video/clipTags";
import {
  buildComposeGroupsFromClips,
  computeMaxRandomCombinations,
  inferComposeGroup,
  type ComposeFilmResult,
} from "@/lib/videoComposeShared";

export type ComposeFilmMode = "sequential" | "random";

export interface ComposeFilmModalResult {
  mode: ComposeFilmMode;
  films: ComposeFilmResult[];
  generated: number;
  videoUrl: string | null;
}

interface ComposeFilmModalProps {
  open: boolean;
  clips: AiVideoClip[];
  selectedClips: AiVideoClip[];
  composing: boolean;
  onCancel: () => void;
  onSubmit: (payload: {
    mode: ComposeFilmMode;
    segments?: Array<{ id: string; name: string; videoUrl: string }>;
    groups?: Array<{ name: string; segments: Array<{ id: string; name: string; videoUrl: string }> }>;
    outputCount?: number;
    orderRule?: string;
    addBackgroundMusic?: boolean;
  }) => Promise<ComposeFilmModalResult | null>;
}

const hintTextStyle = { marginBottom: 0, fontSize: 12, lineHeight: 1.5 };
const compactAlertStyle = { padding: "6px 10px" };

export function ComposeFilmModal({
  open,
  clips,
  selectedClips,
  composing,
  onCancel,
  onSubmit,
}: ComposeFilmModalProps) {
  const [mode, setMode] = useState<ComposeFilmMode>("sequential");
  const [outputCount, setOutputCount] = useState(3);
  const [orderRule, setOrderRule] = useState("");
  const [composeTag, setComposeTag] = useState<string>("");
  const [selectedGroupNames, setSelectedGroupNames] = useState<string[]>([]);
  const [addBackgroundMusic, setAddBackgroundMusic] = useState(true);

  const readyClips = useMemo(
    () => clips.filter((clip) => Boolean(clip.videoUrl)),
    [clips]
  );

  const availableTags = useMemo(() => collectClipTags(readyClips), [readyClips]);

  const tagReadyClips = useMemo(
    () => filterClipsByTag(readyClips, composeTag),
    [composeTag, readyClips]
  );

  const allGroups = useMemo(() => buildComposeGroupsFromClips(tagReadyClips), [tagReadyClips]);

  const allGroupNames = useMemo(() => allGroups.map((group) => group.name), [allGroups]);

  const composeGroups = useMemo(() => {
    const groupMap = new Map(allGroups.map((group) => [group.name, group]));
    return selectedGroupNames
      .map((name) => groupMap.get(name))
      .filter((group): group is NonNullable<typeof group> => Boolean(group));
  }, [allGroups, selectedGroupNames]);

  const maxCombinations = useMemo(() => {
    if (mode !== "random" || composeGroups.length < 2) return null;
    try {
      return computeMaxRandomCombinations(composeGroups, orderRule);
    } catch {
      return null;
    }
  }, [composeGroups, mode, orderRule]);

  useEffect(() => {
    if (!open) return;
    const tagsFromSelection = [
      ...new Set(
        selectedClips
          .map((clip) => String(clip.tag || "").trim())
          .filter(Boolean)
      ),
    ];
    setComposeTag(tagsFromSelection.length === 1 ? tagsFromSelection[0] : "");
    setMode(selectedClips.length >= 2 ? "sequential" : "random");
    setAddBackgroundMusic(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "random" || !composeTag.trim()) {
      setSelectedGroupNames([]);
      return;
    }
    const namesFromSelection = [
      ...new Set(
        selectedClips
          .filter((clip) => String(clip.tag || "").trim() === composeTag.trim())
          .map((clip) => inferComposeGroup(clip.name, clip.composeGroup))
          .filter(Boolean)
      ),
    ];
    setSelectedGroupNames(namesFromSelection);
  }, [composeTag, mode, open, selectedClips]);

  const canSubmitSequential = selectedClips.length >= 2;
  const canSubmitRandom = Boolean(composeTag.trim()) && composeGroups.length >= 2 && composeGroups.every((group) => group.segments.length > 0);
  const canSubmit =
    mode === "sequential"
      ? canSubmitSequential
      : canSubmitRandom &&
        outputCount >= 1 &&
        (maxCombinations === null || BigInt(outputCount) <= maxCombinations);

  function toggleGroup(groupName: string, checked: boolean) {
    setSelectedGroupNames((prev) => {
      if (checked) return prev.includes(groupName) ? prev : [...prev, groupName];
      return prev.filter((name) => name !== groupName);
    });
  }

  async function handleSubmit() {
    if (mode === "sequential") {
      const result = await onSubmit({
        mode: "sequential",
        segments: selectedClips.map((clip) => ({
          id: clip.id,
          name: clip.name,
          videoUrl: clip.videoUrl!,
        })),
        addBackgroundMusic,
      });
      if (result) onCancel();
      return;
    }

    const result = await onSubmit({
      mode: "random",
      groups: composeGroups.map((group) => ({
        name: group.name,
        segments: group.segments.map((segment) => ({
          id: segment.id,
          name: segment.name,
          videoUrl: segment.videoUrl,
        })),
      })),
      outputCount,
      orderRule,
      addBackgroundMusic,
    });
    if (result) onCancel();
  }

  return (
    <Modal
      title="合成成片"
      open={open}
      centered
      destroyOnHidden
      width={640}
      styles={{ body: { padding: "12px 16px 8px", maxHeight: "72vh", overflowY: "auto" } }}
      onCancel={onCancel}
      footer={
        <Space size={8}>
          <Button size="small" onClick={onCancel}>
            取消
          </Button>
          <Button size="small" type="primary" loading={composing} disabled={!canSubmit} onClick={() => void handleSubmit()}>
            开始合成
          </Button>
        </Space>
      }
    >
      <Space orientation="vertical" size={10} style={{ width: "100%" }}>
        <Segmented
          block
          size="small"
          value={mode}
          onChange={(value) => setMode(value as ComposeFilmMode)}
          options={[
            { label: "顺序合成", value: "sequential" },
            { label: "随机混剪", value: "random" },
          ]}
        />

        <Space align="center" style={{ width: "100%", justifyContent: "space-between" }}>
          <Space orientation="vertical" size={0}>
            <Typography.Text strong style={{ fontSize: 13 }}>
              随机背景音乐
            </Typography.Text>
          </Space>
          <Switch size="small" checked={addBackgroundMusic} onChange={setAddBackgroundMusic} />
        </Space>

        {mode === "sequential" ? (
          <>
            <Typography.Paragraph type="secondary" style={hintTextStyle}>
              在片段列表中勾选片段，按勾选顺序拼接为 1 条成片。
            </Typography.Paragraph>
            <Alert
              type={canSubmitSequential ? "info" : "warning"}
              showIcon
              style={compactAlertStyle}
              title={
                canSubmitSequential
                  ? `已选 ${selectedClips.length} 个片段，将合成 1 条成片`
                  : "请先在片段列表勾选至少 2 个已有视频的片段"
              }
            />
            {selectedClips.length ? (
              <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                {selectedClips.map((clip, index) => (
                  <Typography.Text key={clip.id} style={{ fontSize: 12 }}>
                    {index + 1}. {clip.name}{clip.tag ? ` · ${clip.tag}` : ""}
                  </Typography.Text>
                ))}
              </Space>
            ) : null}
          </>
        ) : (
          <>
            <Typography.Paragraph type="secondary" style={hintTextStyle}>
              先选择标签，再勾选该标签下参与混剪的分组；每个分组会随机选 1 个片段。
            </Typography.Paragraph>

            <Space orientation="vertical" size={6} style={{ width: "100%" }}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                标签
              </Typography.Text>
              <Select
                showSearch
                allowClear
                placeholder="选择标签"
                value={composeTag || undefined}
                options={availableTags.map((tag) => ({ value: tag, label: tag }))}
                style={{ width: "100%" }}
                filterOption={(input, option) =>
                  String(option?.label ?? option?.value ?? "")
                    .toLowerCase()
                    .includes(input.trim().toLowerCase())
                }
                onChange={(value) => setComposeTag(value ? String(value) : "")}
              />
              {!availableTags.length ? (
                <Alert
                  type="warning"
                  showIcon
                  style={compactAlertStyle}
                  title="暂无可用于随机混剪的标签。请先在生成或上传片段时设置标签。"
                />
              ) : null}
            </Space>

            <Space orientation="vertical" size={6} style={{ width: "100%" }}>
              <Space align="center" style={{ width: "100%", justifyContent: "space-between" }}>
                <Typography.Text strong style={{ fontSize: 13 }}>
                  参与混剪的分组
                </Typography.Text>
                <Space size={8}>
                  <Button
                    size="small"
                    type="link"
                    style={{ padding: 0, height: "auto" }}
                    disabled={!composeTag.trim()}
                    onClick={() => setSelectedGroupNames(allGroupNames)}
                  >
                    全选
                  </Button>
                  <Button
                    size="small"
                    type="link"
                    style={{ padding: 0, height: "auto" }}
                    onClick={() => setSelectedGroupNames([])}
                  >
                    清空
                  </Button>
                </Space>
              </Space>

              <div
                style={{
                  maxHeight: 180,
                  overflowY: "auto",
                  border: "1px solid var(--vol-hairline)",
                  borderRadius: 6,
                  padding: "6px 10px",
                }}
              >
                {!composeTag.trim() ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    请先选择标签，再勾选该标签下的混剪分组。
                  </Typography.Text>
                ) : allGroups.length ? (
                  <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                    {allGroups.map((group, index) => {
                      const checked = selectedGroupNames.includes(group.name);
                      const orderIndex = selectedGroupNames.indexOf(group.name);
                      return (
                        <div key={group.name}>
                          <Checkbox
                            checked={checked}
                            style={{ alignItems: "flex-start" }}
                            onChange={(e) => toggleGroup(group.name, e.target.checked)}
                          >
                            <Space size={6} wrap>
                              {checked && orderIndex >= 0 ? (
                                <Tag variant="filled" color="blue" style={{ margin: 0, lineHeight: "18px", fontSize: 11 }}>
                                  {orderIndex + 1}
                                </Tag>
                              ) : (
                                <Tag style={{ margin: 0, opacity: 0.45, lineHeight: "18px", fontSize: 11 }}>{index + 1}</Tag>
                              )}
                              <Typography.Text strong style={{ fontSize: 13 }}>
                                {group.name}
                              </Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {group.segments.length} 个片段
                              </Typography.Text>
                            </Space>
                          </Checkbox>
                          <Space
                            orientation="vertical"
                            size={0}
                            style={{ width: "100%", paddingLeft: 26, marginTop: 2 }}
                          >
                            {group.segments.map((segment) => (
                              <Typography.Text key={segment.id} type="secondary" style={{ fontSize: 12, lineHeight: 1.45 }}>
                                · {segment.name}
                              </Typography.Text>
                            ))}
                          </Space>
                        </div>
                      );
                    })}
                  </Space>
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    该标签下暂无可用分组。请先在片段列表勾选片段并使用「设为一组」设置分组。
                  </Typography.Text>
                )}
              </div>

              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已选 {selectedGroupNames.length} / {allGroups.length} 个分组
              </Typography.Text>
            </Space>

            {!composeTag.trim() ? (
              <Alert type="info" showIcon style={compactAlertStyle} title="随机混剪需要先选择标签。" />
            ) : composeGroups.length >= 2 ? null : (
              <Alert
                type="warning"
                showIcon
                style={compactAlertStyle}
                title="请至少勾选 2 个分组，且每组至少包含 1 个可用片段。"
              />
            )}

            <Space orientation="vertical" size={6} style={{ width: "100%" }}>
              <div>
                <Typography.Text style={{ fontSize: 13 }}>片段顺序规则（可选）</Typography.Text>
                <Input
                  size="small"
                  value={orderRule}
                  onChange={(e) => setOrderRule(e.target.value)}
                  placeholder="例如：1-2（前两个分组固定顺序，其余随机）"
                  style={{ marginTop: 4 }}
                />
              </div>
              <div>
                <Typography.Text style={{ fontSize: 13 }}>生成数量</Typography.Text>
                <InputNumber
                  size="small"
                  min={1}
                  max={30}
                  value={outputCount}
                  onChange={(value) => setOutputCount(typeof value === "number" ? value : 1)}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                最大可生成组合数：{maxCombinations === null ? "—" : maxCombinations.toString()}
              </Typography.Text>
            </Space>
          </>
        )}
      </Space>
    </Modal>
  );
}
