"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  App,
  Button,
  Image,
  Input,
  InputNumber,
  Popover,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  AppstoreOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  ExportOutlined,
  PictureOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";
import {
  ASPECT_RATIO_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_RESOLUTION_TIER,
  getResolutionTierLabel,
  RESOLUTION_TIER_OPTIONS,
} from "@/lib/ai-image/constants";
import {
  mutateAiImageHistory,
  prependAiImageHistory,
  readAiImageHistory,
  readAiImageSettings,
  writeAiImageSettings,
} from "@/lib/ai-image/cache";
import {
  formatImageSizeLabel,
  migrateLegacySize,
  normalizeAspectRatio,
  normalizeResolutionTier,
  resolveImageDimensions,
} from "@/lib/ai-image/sizeUtils";
import type {
  AiGeneratedImage,
  AiImageAspectRatio,
  AiImageQuality,
  AiImageResolutionTier,
  AiImageViewMode,
} from "@/lib/ai-image/types";
import {
  readCachedReferenceResources,
  writeReferenceResourcesCache,
  writeStoredConfig,
} from "@/lib/ai-video/cache";
import type { ReferenceResource } from "@/lib/ai-video/types";
import styles from "./page.module.css";

type ApiConfig = {
  model?: string;
  hasServerApiKey?: boolean;
  baseUrl?: string;
};

function normalizeQuality(value: unknown): AiImageQuality {
  if (value === "standard" || value === "hd") return value;
  return "auto";
}

function normalizeViewMode(value: unknown): AiImageViewMode {
  return value === "list" ? "list" : "gallery";
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createVideoResource(image: AiGeneratedImage): ReferenceResource {
  return {
    id: `ai-image-${image.id}-${Date.now()}`,
    name: `AI图片-${new Date(image.createdAt).toLocaleString("zh-CN")}`,
    kind: "image",
    url: image.url,
  };
}

function buildFrameUploadFile(image: AiGeneratedImage): UploadFile {
  return {
    uid: `ai-image-frame-${image.id}`,
    name: "AI生成首帧.png",
    status: "done",
    url: image.url,
    thumbUrl: image.url,
  };
}

function getRatioPreviewStyle(ratio: AiImageAspectRatio, max = 22) {
  if (ratio === "auto") return { width: max, height: max, borderRadius: 999 };
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return { width: max, height: max };
  if (w >= h) {
    return { width: max, height: Math.max(10, Math.round((max * h) / w)) };
  }
  return { width: Math.max(10, Math.round((max * w) / h)), height: max };
}

type ImageActionHandlers = {
  onVideoReference: (image: AiGeneratedImage) => void;
  onFirstFrame: (image: AiGeneratedImage) => void;
  onCopyLink: (url: string) => void;
  onDelete: (id: string) => void;
};

function ImageActionButtons({
  image,
  compact,
  handlers,
}: {
  image: AiGeneratedImage;
  compact?: boolean;
  handlers: ImageActionHandlers;
}) {
  const size = compact ? "small" : "small";
  return (
    <div className={compact ? styles.listActions : styles.imageActions}>
      <Button size={size} icon={<PlusOutlined />} onClick={() => handlers.onVideoReference(image)}>
        视频参考
      </Button>
      <Button size={size} icon={<ExportOutlined />} onClick={() => handlers.onFirstFrame(image)}>
        设为首帧
      </Button>
      <Button size={size} icon={<CopyOutlined />} onClick={() => handlers.onCopyLink(image.url)}>
        链接
      </Button>
      <Button size={size} icon={<DownloadOutlined />} href={image.url} target="_blank">
        下载
      </Button>
      <Button
        size={size}
        danger
        icon={<DeleteOutlined />}
        className={styles.imageActionFull}
        onClick={() => handlers.onDelete(image.id)}
      >
        删除
      </Button>
    </div>
  );
}

export default function AiImagePage() {
  const { message } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [hydrated, setHydrated] = useState(false);
  const [apiConfig, setApiConfig] = useState<ApiConfig>({});
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AiImageAspectRatio>(DEFAULT_ASPECT_RATIO);
  const [resolution, setResolution] = useState<AiImageResolutionTier>(DEFAULT_RESOLUTION_TIER);
  const [quality, setQuality] = useState<AiImageQuality>("auto");
  const [count, setCount] = useState(1);
  const [viewMode, setViewMode] = useState<AiImageViewMode>("gallery");
  const [images, setImages] = useState<AiGeneratedImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [ratioPopoverOpen, setRatioPopoverOpen] = useState(false);

  const syncHistoryFromStorage = useCallback(() => {
    const history = readAiImageHistory();
    setImages(history);
    setSelectedImageId((currentId) => {
      if (!history.length) return null;
      if (currentId && history.some((item) => item.id === currentId)) return currentId;
      return history[0].id;
    });
  }, []);

  useEffect(() => {
    const cachedSettings = readAiImageSettings();
    const migrated =
      cachedSettings.aspectRatio || cachedSettings.resolution
        ? {
            aspectRatio: normalizeAspectRatio(cachedSettings.aspectRatio),
            resolution: normalizeResolutionTier(cachedSettings.resolution),
          }
        : migrateLegacySize(cachedSettings.size);

    syncHistoryFromStorage();
    setPrompt(cachedSettings.prompt || "");
    setAspectRatio(migrated.aspectRatio);
    setResolution(migrated.resolution);
    setQuality(normalizeQuality(cachedSettings.quality));
    setCount(Math.min(4, Math.max(1, Number(cachedSettings.count) || 1)));
    setViewMode(normalizeViewMode(cachedSettings.viewMode));
    setHydrated(true);
  }, [syncHistoryFromStorage]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        syncHistoryFromStorage();
      }
    }
    window.addEventListener("focus", syncHistoryFromStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", syncHistoryFromStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncHistoryFromStorage]);

  useEffect(() => {
    if (pathname === "/ai-image") {
      syncHistoryFromStorage();
    }
  }, [pathname, syncHistoryFromStorage]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai-image/generate", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setApiConfig(data || {});
      })
      .catch(() => {
        if (!cancelled) setApiConfig({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeAiImageSettings({ prompt, aspectRatio, resolution, quality, count, viewMode });
  }, [aspectRatio, count, hydrated, prompt, quality, resolution, viewMode]);

  useEffect(() => {
    if (!images.length) {
      setSelectedImageId(null);
      return;
    }
    if (!selectedImageId || !images.some((item) => item.id === selectedImageId)) {
      setSelectedImageId(images[0].id);
    }
  }, [images, selectedImageId]);

  const resolvedSize = useMemo(
    () => resolveImageDimensions(aspectRatio, resolution),
    [aspectRatio, resolution]
  );

  const currentAspectRatio = useMemo(
    () => ASPECT_RATIO_OPTIONS.find((item) => item.value === aspectRatio) ?? ASPECT_RATIO_OPTIONS[0],
    [aspectRatio]
  );

  const selectedImage = useMemo(
    () => images.find((item) => item.id === selectedImageId) ?? images[0] ?? null,
    [images, selectedImageId]
  );

  const ratioPicker = (
    <div className={styles.ratioPopoverGrid}>
      {ASPECT_RATIO_OPTIONS.map((item) => (
        <button
          key={item.value}
          type="button"
          className={`${styles.ratioPopoverItem} ${
            item.value === aspectRatio ? styles.ratioPopoverItemActive : ""
          }`}
          onClick={() => {
            setAspectRatio(item.value);
            setRatioPopoverOpen(false);
          }}
        >
          <span
            className={styles.ratioPreview}
            style={getRatioPreviewStyle(item.value, 20)}
            aria-hidden
          />
          <span className={styles.ratioLabel}>{item.label}</span>
        </button>
      ))}
    </div>
  );

  const updateImages = useCallback((updater: (prev: AiGeneratedImage[]) => AiGeneratedImage[]) => {
    const next = mutateAiImageHistory(updater);
    setImages(next);
  }, []);

  const actionHandlers = useMemo<ImageActionHandlers>(
    () => ({
      onVideoReference: (image) => {
        const current = readCachedReferenceResources();
        const next = [
          ...current.filter((item) => item.url !== image.url),
          createVideoResource(image),
        ];
        writeReferenceResourcesCache(next);
        writeStoredConfig({
          mode: "multimodal-reference",
          prompt: image.revisedPrompt || image.prompt,
        });
        message.success("已加入 AI 视频参考素材");
        router.push("/ai-video");
      },
      onFirstFrame: (image) => {
        writeStoredConfig({
          mode: "first-frame",
          prompt: image.revisedPrompt || image.prompt,
          firstFrameUrl: image.url,
          firstFrameFiles: [buildFrameUploadFile(image)],
        });
        message.success("已设为 AI 视频首帧");
        router.push("/ai-video");
      },
      onCopyLink: (url) => {
        void navigator.clipboard
          .writeText(url)
          .then(() => message.success("图片链接已复制"))
          .catch(() => message.error("复制失败"));
      },
      onDelete: (id) => {
        updateImages((prev) => prev.filter((item) => item.id !== id));
      },
    }),
    [message, router, updateImages]
  );

  async function handleGenerate() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      message.warning("请先输入图片提示词");
      return;
    }
    if (!apiConfig.hasServerApiKey) {
      message.warning("请先配置 AI_IMAGE_API_KEY");
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch("/api/ai-image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          aspectRatio,
          resolution,
          size: resolvedSize,
          quality,
          count,
        }),
      });
      const data = (await res.json()) as { images?: AiGeneratedImage[]; error?: string };
      if (!res.ok || !Array.isArray(data.images)) {
        throw new Error(data.error || "图片生成失败");
      }
      const next = prependAiImageHistory(data.images);
      setImages(next);
      setSelectedImageId(data.images[0]?.id ?? null);
      message.success(`已生成 ${data.images.length} 张图片`);
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : "图片生成失败");
    } finally {
      setGenerating(false);
    }
  }

  function copyPrompt() {
    void navigator.clipboard
      .writeText(prompt.trim())
      .then(() => message.success("提示词已复制"))
      .catch(() => message.error("复制失败"));
  }

  function renderGalleryView() {
    if (!selectedImage) return null;

    return (
      <div className={styles.galleryLayout}>
        <div className={styles.previewStage}>
          <div className={styles.previewHeroWrap}>
            <Image
              src={selectedImage.url}
              alt={selectedImage.revisedPrompt || selectedImage.prompt}
              className={styles.previewHeroImg}
              preview={{ src: selectedImage.url }}
            />
          </div>
          <div className={styles.previewMeta}>
            <div className={styles.previewPrompt}>
              {selectedImage.revisedPrompt || selectedImage.prompt}
            </div>
            <Space size={6} wrap>
              <Tag>{formatImageSizeLabel(selectedImage.size)}</Tag>
              {selectedImage.quality !== "auto" ? (
                <Tag>{selectedImage.quality.toUpperCase()}</Tag>
              ) : null}
              <Tag>{formatCreatedAt(selectedImage.createdAt)}</Tag>
            </Space>
            <ImageActionButtons image={selectedImage} handlers={actionHandlers} />
          </div>
        </div>

        <div className={styles.thumbnailStrip} role="list" aria-label="历史图片缩略图">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              role="listitem"
              className={`${styles.thumbnailItem} ${
                image.id === selectedImage.id ? styles.thumbnailItemActive : ""
              }`}
              onClick={() => setSelectedImageId(image.id)}
            >
              <img src={image.url} alt={image.revisedPrompt || image.prompt} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderListView() {
    return (
      <div className={styles.imageList}>
        {images.map((image) => (
          <article
            key={image.id}
            className={`${styles.listRow} ${
              image.id === selectedImageId ? styles.listRowActive : ""
            }`}
            onClick={() => setSelectedImageId(image.id)}
          >
            <button
              type="button"
              className={styles.listThumbButton}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedImageId(image.id);
              }}
            >
              <Image
                src={image.url}
                alt={image.revisedPrompt || image.prompt}
                width={72}
                height={72}
                className={styles.listThumb}
                preview={{ src: image.url }}
              />
            </button>
            <div className={styles.listBody}>
              <div className={styles.listPrompt}>{image.revisedPrompt || image.prompt}</div>
              <Space size={6} wrap className={styles.listTags}>
                <Tag>{formatImageSizeLabel(image.size)}</Tag>
                {image.quality !== "auto" ? <Tag>{image.quality.toUpperCase()}</Tag> : null}
                <Tag>{formatCreatedAt(image.createdAt)}</Tag>
              </Space>
            </div>
            <div
              className={styles.listActionsWrap}
              onClick={(event) => event.stopPropagation()}
            >
              <ImageActionButtons image={image} compact handlers={actionHandlers} />
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className={`${styles.page} app-page-fill`}>
      <header className={styles.hero}>
        <div className={styles.heroLeading}>
          <span className={styles.heroIcon} aria-hidden>
            <PictureOutlined />
          </span>
          <div className={styles.heroMain}>
            <Typography.Title level={3} className={styles.title}>
              AI 图片生成
            </Typography.Title>
            <Typography.Text type="secondary" className={styles.subtitle}>
              gpt-image-2 · 历史本地保存 · 可一键转入 AI 视频
            </Typography.Text>
          </div>
        </div>
        <div className={styles.heroMeta}>
          <span className={styles.modelPill}>{apiConfig.model || "gpt-image-2"}</span>
          <span
            className={`${styles.statusPill} ${
              apiConfig.hasServerApiKey ? styles.statusPillOk : styles.statusPillWarn
            }`}
          >
            <span className={styles.statusDot} aria-hidden />
            {apiConfig.hasServerApiKey ? "已连接" : "未配置 Key"}
          </span>
        </div>
      </header>

      <div className={styles.workspace}>
        <section className={styles.controlPanel}>
          <div className={styles.panelHead}>
            <span className={styles.panelHeadTitle}>创作参数</span>
            <span className={styles.panelHeadHint}>左侧填写，右侧预览</span>
          </div>

          <div className={styles.promptSection}>
            <div className={styles.promptHeader}>
              <span className={styles.sectionLabel}>图片提示词</span>
              <Space size={8} align="center">
                <span className={styles.promptCount}>
                  {prompt.length} / 2000
                </span>
                <Tooltip title="复制提示词">
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={copyPrompt}
                    disabled={!prompt.trim()}
                  >
                    复制
                  </Button>
                </Tooltip>
              </Space>
            </div>
            <div className={styles.promptFill}>
              <Input.TextArea
                className={styles.promptInput}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="描述产品图、海报或视频首帧：主体、场景、光线、构图"
                rows={10}
                maxLength={2000}
              />
            </div>
          </div>

          <div className={styles.sectionDivider} role="separator" />

          <div className={styles.outputSection}>
            <span className={styles.sectionLabel}>输出设置</span>
            <div className={styles.compactSettings}>
              <div className={styles.settingItem}>
                <span className={styles.settingLabel}>比例</span>
                <Popover
                  open={ratioPopoverOpen}
                  onOpenChange={setRatioPopoverOpen}
                  content={ratioPicker}
                  trigger="click"
                  placement="bottomLeft"
                  arrow={false}
                >
                  <Button className={styles.ratioTrigger}>
                    <span
                      className={styles.ratioPreviewInline}
                      style={getRatioPreviewStyle(aspectRatio, 16)}
                      aria-hidden
                    />
                    <span>{currentAspectRatio.label}</span>
                    <DownOutlined className={styles.ratioTriggerIcon} />
                  </Button>
                </Popover>
              </div>

              <div className={styles.settingItem}>
                <span className={styles.settingLabel}>分辨率</span>
                <Segmented
                  size="small"
                  value={resolution}
                  onChange={setResolution}
                  options={RESOLUTION_TIER_OPTIONS.map((item) => ({
                    label: item.label,
                    value: item.value,
                  }))}
                />
              </div>

              <div className={styles.settingItem}>
                <span className={styles.settingLabel}>质量</span>
                <Segmented
                  size="small"
                  value={quality}
                  onChange={(value) => setQuality(normalizeQuality(value))}
                  options={[
                    { label: "Auto", value: "auto" },
                    { label: "标准", value: "standard" },
                    { label: "HD", value: "hd" },
                  ]}
                />
              </div>

              <div className={styles.settingItem}>
                <span className={styles.settingLabel}>数量</span>
                <InputNumber
                  size="small"
                  min={1}
                  max={4}
                  value={count}
                  onChange={(value) => setCount(Math.min(4, Math.max(1, Number(value) || 1)))}
                  className={styles.compactCount}
                />
              </div>
            </div>

            <div className={styles.sizePreview}>
              输出 <strong>{formatImageSizeLabel(resolvedSize)}</strong>
              {aspectRatio !== "auto" ? (
                <span>
                  {" "}
                  · {aspectRatio} · {getResolutionTierLabel(resolution)}
                </span>
              ) : (
                <span> · 尺寸自动</span>
              )}
            </div>
          </div>

          <div className={styles.sectionDivider} role="separator" />

          <div className={styles.submitRow}>
            <Button
              type="primary"
              size="large"
              icon={generating ? undefined : <ThunderboltOutlined />}
              loading={generating}
              onClick={() => void handleGenerate()}
              className={styles.generateButton}
            >
              {generating ? "生成中…" : "生成图片"}
            </Button>
          </div>
        </section>

        <section className={styles.galleryPanel}>
          <div className={styles.galleryToolbar}>
            <div className={styles.galleryToolbarMain}>
              <Typography.Title level={4} className={styles.galleryTitle}>
                历史记录
              </Typography.Title>
              <span className={styles.countBadge}>
                <PictureOutlined />
                {images.length} 张
              </span>
            </div>
            <Space size={8} wrap>
              <Segmented<AiImageViewMode>
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { label: "画廊", value: "gallery", icon: <AppstoreOutlined /> },
                  { label: "列表", value: "list", icon: <UnorderedListOutlined /> },
                ]}
              />
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={!images.length}
                onClick={() => {
                  updateImages(() => []);
                  message.success("历史记录已清空");
                }}
              >
                清空
              </Button>
            </Space>
          </div>

          <div className={styles.galleryBody}>
            {generating && !images.length ? (
              <div className={styles.generatingOverlay}>
                <div className={styles.generatingCard}>
                  <div className={styles.generatingCanvas} aria-hidden>
                    <div className={styles.generatingCanvasGrid} />
                    <div className={styles.generatingShimmer} />
                  </div>
                  <div className={styles.generatingMeta}>
                    <span className={styles.generatingTitle}>正在绘制画面</span>
                    <span className={styles.generatingDesc}>
                      {apiConfig.model || "gpt-image-2"} · 通常需要 10–30 秒
                    </span>
                    <div className={styles.generatingProgressTrack} aria-hidden>
                      <div className={styles.generatingProgressBar} />
                    </div>
                  </div>
                </div>
              </div>
            ) : images.length ? (
              viewMode === "gallery" ? renderGalleryView() : renderListView()
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyVisual} aria-hidden>
                  <span className={styles.emptyFrame} />
                  <span className={styles.emptyFrame} />
                  <span className={styles.emptyFrame} />
                </div>
                <div className={styles.emptyCopy}>
                  <span className={styles.emptyTitle}>等待你的第一张作品</span>
                  <span className={styles.emptyDesc}>
                    填写提示词并点击生成，结果会保存在本地，支持画廊与列表预览
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
