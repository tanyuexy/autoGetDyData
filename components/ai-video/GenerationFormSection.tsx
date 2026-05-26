"use client";

import type { RefObject } from "react";
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import type { UploadFile, UploadProps } from "antd/es/upload/interface";
import {
  DeleteOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { VideoFrameThumbnail } from "@/components/ai-video/ClipVideoThumbnail";
import { ClipTagSelect } from "@/components/ai-video/ClipTagSelect";
import { ReferenceResourcesList } from "@/components/ai-video/ReferenceResourcesList";
import { RATIO_OPTIONS, RESOLUTION_OPTIONS } from "@/lib/ai-video/constants";
import { getReferenceLabel } from "@/lib/ai-video/clipUtils";
import { framePreviewStyle, sectionStyle } from "@/lib/ai-video/styles";
import type { GenerationMode, ReferenceResource, SeedanceModelOption } from "@/lib/ai-video/types";
import { antdTagPresetStyle } from "@/lib/semanticTagStyles";
import {
  getSeedanceDurationConfig,
  normalizeSeedanceDuration,
} from "@/lib/volcengineSeedanceDuration";

export interface GenerationFormSectionProps {
  mode: GenerationMode;
  setMode: (mode: GenerationMode) => void;
  model: string;
  setModel: (model: string) => void;
  modelOptions: Array<{ label: string; value: string }>;
  selectedModel: SeedanceModelOption | undefined;
  hasServerApiKey: boolean;
  prompt: string;
  promptTextAreaRef: RefObject<HTMLTextAreaElement | null>;
  resourcePickerOpen: boolean;
  resourcePickerActiveIndex: number;
  setResourcePickerActiveIndex: (index: number | ((prev: number) => number)) => void;
  setResourcePickerOpen: (open: boolean) => void;
  referenceResources: ReferenceResource[];
  draggingReferenceId: string | null;
  dragOverReferenceId: string | null;
  onPromptChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onPromptKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPromptBlur: () => void;
  onInsertReferenceTokenAtPrompt: (resource: ReferenceResource) => void;
  onInsertReferenceToken: (resource: ReferenceResource) => void;
  onReferenceDragStart: (event: React.DragEvent, id: string) => void;
  onReferenceDragOver: (event: React.DragEvent, id: string) => void;
  onReferenceDragLeave: (event: React.DragEvent, id: string) => void;
  onReferenceDrop: (event: React.DragEvent, targetId: string) => void;
  onReferenceDragEnd: () => void;
  onRemoveReferenceResource: (id: string) => void;
  referenceUploadProps: UploadProps;
  uploadingReference: boolean;
  firstFrameUrl: string;
  lastFrameUrl: string;
  firstFrameFiles: UploadFile[];
  lastFrameFiles: UploadFile[];
  setFirstFrameFiles: (files: UploadFile[]) => void;
  setFirstFrameUrl: (url: string) => void;
  setLastFrameFiles: (files: UploadFile[]) => void;
  setLastFrameUrl: (url: string) => void;
  buildFrameUploadProps: (
    target: "first" | "last",
    fileList: UploadFile[],
    setFileList: (files: UploadFile[]) => void,
    setUrl: (url: string) => void
  ) => UploadProps;
  clearFrameUpload: (target: "first" | "last") => void;
  ratio: string;
  setRatio: (ratio: string) => void;
  resolution: string;
  setResolution: (resolution: string) => void;
  duration: number;
  setDuration: (duration: number) => void;
  durationConfig: ReturnType<typeof getSeedanceDurationConfig>;
  generateAudio: boolean;
  setGenerateAudio: (value: boolean) => void;
  watermark: boolean;
  setWatermark: (value: boolean) => void;
  seed: number | null;
  setSeed: (value: number | null) => void;
  showCallbackUrl: boolean;
  callbackUrl: string;
  setCallbackUrl: (url: string) => void;
  clipTag: string;
  setClipTag: (value: string) => void;
  clipTagOptions: Array<{ value: string; label: string }>;
  submitting: boolean;
  onSubmitTask: () => void;
  onOpenGeneratePrompt: () => void;
  dragActive: boolean;
  onFrameDragEnter?: (event: React.DragEvent) => void;
  onFrameDragLeave?: (event: React.DragEvent) => void;
  onFrameDragOver: (event: React.DragEvent) => void;
  onReferenceDropOverlay: (event: React.DragEvent) => void;
  onFrameDrop: (event: React.DragEvent, target: "first" | "last") => void;
}

function renderFrameUploadButton(
  label: string,
  url: string,
  uploadProps: UploadProps
) {
  return (
    <Upload {...uploadProps}>
      <Button icon={<UploadOutlined />}>{url ? `重新上传${label}` : `上传${label}`}</Button>
    </Upload>
  );
}

function renderFramePreview(
  target: "first" | "last",
  label: string,
  url: string,
  fileList: UploadFile[],
  onClear: (target: "first" | "last") => void
) {
  const file = fileList[0];
  if (!url || !file) return null;

  return (
    <div style={{ ...framePreviewStyle, maxWidth: 360 }}>
      <img
        src={url}
        alt={file.name}
        style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
      />
      <Typography.Text ellipsis style={{ flex: 1, minWidth: 0 }}>
        {file.name}
      </Typography.Text>
      <Button
        type="text"
        danger
        icon={<DeleteOutlined />}
        aria-label={`删除${label}`}
        onClick={() => onClear(target)}
      />
    </div>
  );
}

export function GenerationFormSection(props: GenerationFormSectionProps) {
  const {
    mode,
    setMode,
    model,
    setModel,
    modelOptions,
    selectedModel,
    hasServerApiKey,
    prompt,
    promptTextAreaRef,
    resourcePickerOpen,
    resourcePickerActiveIndex,
    setResourcePickerActiveIndex,
    setResourcePickerOpen,
    referenceResources,
    draggingReferenceId,
    dragOverReferenceId,
    onPromptChange,
    onPromptKeyDown,
    onPromptBlur,
    onInsertReferenceTokenAtPrompt,
    onInsertReferenceToken,
    onReferenceDragStart,
    onReferenceDragOver,
    onReferenceDragLeave,
    onReferenceDrop,
    onReferenceDragEnd,
    onRemoveReferenceResource,
    referenceUploadProps,
    uploadingReference,
    firstFrameUrl,
    lastFrameUrl,
    firstFrameFiles,
    lastFrameFiles,
    setFirstFrameFiles,
    setFirstFrameUrl,
    setLastFrameFiles,
    setLastFrameUrl,
    buildFrameUploadProps,
    clearFrameUpload,
    ratio,
    setRatio,
    resolution,
    setResolution,
    duration,
    setDuration,
    durationConfig,
    generateAudio,
    setGenerateAudio,
    watermark,
    setWatermark,
    seed,
    setSeed,
    showCallbackUrl,
    callbackUrl,
    setCallbackUrl,
    clipTag,
    setClipTag,
    clipTagOptions,
    submitting,
    onSubmitTask,
    onOpenGeneratePrompt,
    dragActive,
    onFrameDragEnter,
    onFrameDragLeave,
    onFrameDragOver,
    onReferenceDropOverlay,
    onFrameDrop,
  } = props;

  const firstFrameUploadProps = buildFrameUploadProps("first", firstFrameFiles, setFirstFrameFiles, setFirstFrameUrl);
  const lastFrameUploadProps = buildFrameUploadProps("last", lastFrameFiles, setLastFrameFiles, setLastFrameUrl);

  return (
    <section
      style={{ ...sectionStyle, position: "relative" }}
      onDragEnter={mode === "first-frame" || mode === "first-last-frame" ? onFrameDragEnter : undefined}
      onDragLeave={mode === "first-frame" || mode === "first-last-frame" ? onFrameDragLeave : undefined}
      onDragOver={mode === "first-frame" || mode === "first-last-frame" ? onFrameDragOver : undefined}
    >
      {dragActive && mode === "first-frame" ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            borderRadius: 8,
            background: "rgba(22, 119, 255, 0.08)",
            border: "2px dashed #1677ff",
            pointerEvents: "auto",
          }}
          onDragOver={onFrameDragOver}
          onDrop={onReferenceDropOverlay}
        >
          <UploadOutlined style={{ fontSize: 28, color: "#1677ff" }} />
          <Typography.Text strong style={{ color: "#1677ff" }}>
            松开上传资源
          </Typography.Text>
        </div>
      ) : null}
      {dragActive && mode === "first-last-frame" ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 20,
            display: "flex",
            borderRadius: 8,
            overflow: "hidden",
            background: "rgba(22, 119, 255, 0.08)",
            border: "2px dashed #1677ff",
            pointerEvents: "none",
          }}
        >
          <>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                borderRight: "1px dashed rgba(22, 119, 255, 0.45)",
                pointerEvents: "auto",
              }}
              onDragOver={onFrameDragOver}
              onDrop={(event) => onFrameDrop(event, "first")}
            >
              <UploadOutlined style={{ fontSize: 28, color: "#1677ff" }} />
              <Typography.Text strong style={{ color: "#1677ff" }}>
                松开上传首帧图片
              </Typography.Text>
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                pointerEvents: "auto",
              }}
              onDragOver={onFrameDragOver}
              onDrop={(event) => onFrameDrop(event, "last")}
            >
              <UploadOutlined style={{ fontSize: 28, color: "#1677ff" }} />
              <Typography.Text strong style={{ color: "#1677ff" }}>
                松开上传尾帧图片
              </Typography.Text>
            </div>
          </>
        </div>
      ) : null}

      <Space orientation="vertical" size={14} style={{ width: "100%" }}>
        <Space wrap align="center" size={12}>
          <Segmented<GenerationMode>
            value={mode}
            onChange={setMode}
            options={[
              { label: "首帧", value: "first-frame" },
              { label: "首尾帧", value: "first-last-frame" },
              { label: "文生视频", value: "text" },
            ]}
          />
          <Select value={model} onChange={setModel} options={modelOptions} style={{ minWidth: 300 }} />
          <Space>
            {selectedModel?.generation.map((item) => (
              <Tag key={item} style={antdTagPresetStyle("blue")}>
                {item}
              </Tag>
            ))}
          </Space>
        </Space>

        {!hasServerApiKey ? (
          <Alert
            type="warning"
            showIcon
            title="请先在服务端环境变量中配置 VOLCENGINE_ARK_API_KEY 或 ARK_API_KEY"
          />
        ) : null}

        <Space orientation="vertical" size={4} style={{ width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <Typography.Text strong>视频提示词</Typography.Text>
            <Button icon={<RobotOutlined />} onClick={onOpenGeneratePrompt}>
              AI 生成提示词
            </Button>
          </div>
          <div style={{ position: "relative", width: "100%" }}>
            <Input.TextArea
              ref={(node) => {
                promptTextAreaRef.current = node?.resizableTextArea?.textArea || null;
              }}
              value={prompt}
              onChange={onPromptChange}
              onKeyDown={onPromptKeyDown}
              onBlur={onPromptBlur}
              placeholder="输入画面、运镜、主体动作、风格、镜头衔接要求"
              autoSize={{ minRows: 4, maxRows: 8 }}
              maxLength={1800}
            />
            {resourcePickerOpen && referenceResources.length ? (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: "100%",
                  zIndex: 30,
                  width: 360,
                  maxWidth: "min(360px, 100%)",
                  marginTop: 6,
                  padding: 6,
                  border: "1px solid var(--vol-hairline)",
                  borderRadius: 8,
                  background: "var(--vol-canvas-soft)",
                  boxShadow: "0 10px 30px rgba(17, 17, 17, 0.12)",
                  maxHeight: 240,
                  overflowY: "auto",
                }}
                role="listbox"
                aria-label="选择参考资源"
              >
                <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                  {referenceResources.map((resource, index) => {
                    const label = getReferenceLabel(referenceResources, resource);
                    const active = index === resourcePickerActiveIndex;
                    return (
                      <button
                        key={resource.id}
                        id={`resource-picker-item-${index}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setResourcePickerActiveIndex(index)}
                        onClick={() => onInsertReferenceTokenAtPrompt(resource)}
                        style={{
                          width: "100%",
                          border: 0,
                          borderRadius: 6,
                          padding: "7px 8px",
                          background: active ? "rgba(22, 119, 255, 0.12)" : "transparent",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          textAlign: "left",
                        }}
                      >
                        {resource.kind === "image" ? (
                          <img
                            src={resource.url}
                            alt={resource.name}
                            style={{
                              width: 28,
                              height: 28,
                              objectFit: "cover",
                              borderRadius: 4,
                              flexShrink: 0,
                            }}
                          />
                        ) : resource.kind === "video" ? (
                          <VideoFrameThumbnail
                            videoUrl={resource.url}
                            width={28}
                            height={28}
                            borderRadius={4}
                            showPlayIcon={false}
                          />
                        ) : (
                          <span
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 4,
                              background: "#111",
                              color: "#fff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <PaperClipOutlined />
                          </span>
                        )}
                        <Typography.Text strong style={{ width: 58, flexShrink: 0 }}>
                          @{label}
                        </Typography.Text>
                        <Typography.Text type="secondary" ellipsis style={{ flex: 1, minWidth: 0 }}>
                          {resource.name}
                        </Typography.Text>
                      </button>
                    );
                  })}
                </Space>
              </div>
            ) : null}
          </div>
          <Typography.Text type="secondary" style={{ alignSelf: "flex-end", fontSize: 12, lineHeight: "18px" }}>
            {prompt.length} / 1800
          </Typography.Text>
        </Space>

        {mode === "first-frame" ? (
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            <Space wrap align="center" size={8}>
              <Upload {...referenceUploadProps}>
                <Button icon={<UploadOutlined />} loading={uploadingReference}>
                  {referenceResources.length ? "继续上传资源" : "上传资源"}
                </Button>
              </Upload>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                支持拖拽到上方表单区域上传；拖动资源项可调整顺序（影响 @图片1 编号及提交顺序）；多张或含视频/音频时用参考模式（提示词中用 @图片1 指定首帧）
              </Typography.Text>
            </Space>
            {referenceResources.length ? (
              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                <ReferenceResourcesList
                  referenceResources={referenceResources}
                  draggingReferenceId={draggingReferenceId}
                  dragOverReferenceId={dragOverReferenceId}
                  onDragStart={onReferenceDragStart}
                  onDragOver={onReferenceDragOver}
                  onDragLeave={onReferenceDragLeave}
                  onDrop={onReferenceDrop}
                  onDragEnd={onReferenceDragEnd}
                  onInsertToken={onInsertReferenceToken}
                  onRemove={onRemoveReferenceResource}
                />
              </Space>
            ) : null}
          </Space>
        ) : null}

        {mode === "first-last-frame" ? (
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            <Space wrap size={8} align="center">
              {renderFrameUploadButton("首帧图片", firstFrameUrl, firstFrameUploadProps)}
              {renderFrameUploadButton("尾帧图片", lastFrameUrl, lastFrameUploadProps)}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                首尾帧模式仅支持上传首帧图和尾帧图
              </Typography.Text>
            </Space>
            {firstFrameUrl || lastFrameUrl ? (
              <Space wrap size={12} align="start">
                {renderFramePreview("first", "首帧图片", firstFrameUrl, firstFrameFiles, clearFrameUpload)}
                {renderFramePreview("last", "尾帧图片", lastFrameUrl, lastFrameFiles, clearFrameUpload)}
              </Space>
            ) : null}
          </Space>
        ) : null}

        <Space wrap size={14}>
          <Space orientation="vertical" size={4}>
            <Typography.Text strong>比例</Typography.Text>
            <Select value={ratio} onChange={setRatio} options={RATIO_OPTIONS} style={{ width: 110 }} />
          </Space>
          <Space orientation="vertical" size={4}>
            <Typography.Text strong>分辨率</Typography.Text>
            <Select value={resolution} onChange={setResolution} options={RESOLUTION_OPTIONS} style={{ width: 120 }} />
          </Space>
          <Space orientation="vertical" size={4}>
            <Tooltip title={`当前模型支持 ${durationConfig.min}–${durationConfig.max} 秒，按 1 秒步进调整`}>
              <Typography.Text strong style={{ cursor: "help", borderBottom: "1px dashed var(--vol-hairline)" }}>
                时长
              </Typography.Text>
            </Tooltip>
            <Space.Compact>
              <InputNumber
                value={duration}
                min={durationConfig.min}
                max={durationConfig.max}
                step={1}
                precision={0}
                onChange={(value) =>
                  setDuration(
                    normalizeSeedanceDuration(model, typeof value === "number" ? value : durationConfig.default)
                  )
                }
                style={{ width: 88 }}
              />
              <Button disabled style={{ pointerEvents: "none" }}>
                秒
              </Button>
            </Space.Compact>
          </Space>
          <Space orientation="vertical" size={4}>
            <Typography.Text strong>声音</Typography.Text>
            <Switch checked={generateAudio} checkedChildren="有" unCheckedChildren="无" onChange={setGenerateAudio} />
          </Space>
          <Space orientation="vertical" size={4}>
            <Typography.Text strong>水印</Typography.Text>
            <Switch checked={watermark} checkedChildren="开" unCheckedChildren="关" onChange={setWatermark} />
          </Space>
          <Space orientation="vertical" size={4}>
            <Tooltip title="固定随机种子可在相同提示词和参数下尽量复现生成结果；留空则每次随机。">
              <Typography.Text strong style={{ cursor: "help", borderBottom: "1px dashed var(--vol-hairline)" }}>
                Seed
              </Typography.Text>
            </Tooltip>
            <Space.Compact>
              <InputNumber
                value={seed ?? undefined}
                min={0}
                max={2147483647}
                placeholder="随机"
                onChange={(value) => setSeed(typeof value === "number" && Number.isFinite(value) ? value : null)}
                style={{ width: 118 }}
              />
              <Button onClick={() => setSeed(null)}>随机</Button>
            </Space.Compact>
          </Space>
        </Space>

        {showCallbackUrl ? (
          <Input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="Callback URL（可选）" />
        ) : null}

        <Space orientation="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Text strong>
            标签<Typography.Text type="danger"> *</Typography.Text>
          </Typography.Text>
          <Space wrap align="center" size={12}>
            <ClipTagSelect
              value={clipTag}
              options={clipTagOptions}
              style={{ width: 240 }}
              onChange={setClipTag}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              用于标识片段、列表筛选，以及随机混剪时先按标签再选分组
            </Typography.Text>
          </Space>
        </Space>

        <Space>
          <Button type="primary" icon={<PlayCircleOutlined />} loading={submitting} onClick={onSubmitTask}>
            生成片段
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            默认关闭水印；生成后会自动轮询任务状态
          </Typography.Text>
        </Space>
      </Space>
    </section>
  );
}
