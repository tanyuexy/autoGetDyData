"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Spin,
  Upload,
} from "antd";
import type { UploadProps } from "antd";
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
  UploadOutlined,
} from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";
import {
  ASPECT_RATIO_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_RESOLUTION_TIER,
  getResolutionTierLabel,
  getAiImageQualityLabel,
  MAX_REFERENCE_IMAGES,
  normalizeAiImageQuality,
  DEFAULT_AI_IMAGE_QUALITY,
  QUALITY_OPTIONS,
  RESOLUTION_TIER_OPTIONS,
} from "@/lib/ai-image/constants";
import {
  mutateAiImageHistory,
  normalizeAiImageReferences,
  prependAiImageHistory,
  readAiImageHistory,
  readAiImageSettings,
  resolveCachedAiImageQuality,
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
  AiImageReference,
  AiImageResolutionTier,
  AiImageViewMode,
} from "@/lib/ai-image/types";
import { resolveMediaUrl } from "@/lib/ai-video/media";
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

function createReferenceId() {
  return `ai-ref-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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
  const [quality, setQuality] = useState<AiImageQuality>(DEFAULT_AI_IMAGE_QUALITY);
  const [count, setCount] = useState(1);
  const [viewMode, setViewMode] = useState<AiImageViewMode>("gallery");
  const [images, setImages] = useState<AiGeneratedImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [ratioPopoverOpen, setRatioPopoverOpen] = useState(false);
  const [referenceImages, setReferenceImages] = useState<AiImageReference[]>([]);
  const referenceUploadBusyRef = useRef(0);
  const referenceDragCounterRef = useRef(0);
  const [uploadingReference, setUploadingReference] = useState(false);
  const [referenceDragActive, setReferenceDragActive] = useState(false);

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
    setQuality(resolveCachedAiImageQuality(cachedSettings));
    setCount(Math.min(4, Math.max(1, Number(cachedSettings.count) || 1)));
    setViewMode(normalizeViewMode(cachedSettings.viewMode));
    setReferenceImages(normalizeAiImageReferences(cachedSettings.referenceImages).slice(0, MAX_REFERENCE_IMAGES));
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
    writeAiImageSettings({
      prompt,
      aspectRatio,
      resolution,
      quality,
      count,
      viewMode,
      referenceImages: referenceImages.filter((item) => !item.url.startsWith("blob:")),
    });
  }, [aspectRatio, count, hydrated, prompt, quality, referenceImages, resolution, viewMode]);

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

  const setReferenceUploadBusy = useCallback((delta: number) => {
    referenceUploadBusyRef.current = Math.max(0, referenceUploadBusyRef.current + delta);
    setUploadingReference(referenceUploadBusyRef.current > 0);
  }, []);

  const uploadReferenceImage = useCallback(
    async (file: File) => {
      if (referenceImages.length >= MAX_REFERENCE_IMAGES) {
        message.warning(`最多上传 ${MAX_REFERENCE_IMAGES} 张参考图`);
        return;
      }
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      const ext = file.name.toLowerCase();
      if (!allowed.includes(file.type) && !/\.(jpe?g|png|webp)$/i.test(ext)) {
        message.error("参考图仅支持 JPG、PNG、WebP");
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        message.error("参考图不能超过 12MB");
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      const pendingId = createReferenceId();
      setReferenceImages((prev) => [
        ...prev,
        { id: pendingId, name: file.name, url: previewUrl, size: file.size },
      ]);
      setReferenceUploadBusy(1);

      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/ai-image/upload", { method: "POST", body: formData });
        const raw = await res.text();
        let data: { url?: string; name?: string; size?: number; error?: string } = {};
        try {
          data = raw ? (JSON.parse(raw) as typeof data) : {};
        } catch {
          throw new Error("上传接口返回异常，请稍后重试");
        }
        const uploadedUrl = data.url;
        if (!res.ok || !uploadedUrl) throw new Error(data.error || "上传参考图失败");
        setReferenceImages((prev) =>
          prev.map((item) =>
            item.id === pendingId
              ? {
                  id: item.id,
                  name: data.name || file.name,
                  url: uploadedUrl,
                  size: data.size || file.size,
                }
              : item
          )
        );
        message.success("参考图已上传");
      } catch (error: unknown) {
        setReferenceImages((prev) => prev.filter((item) => item.id !== pendingId));
        message.error(error instanceof Error ? error.message : "上传参考图失败");
      } finally {
        URL.revokeObjectURL(previewUrl);
        setReferenceUploadBusy(-1);
      }
    },
    [message, referenceImages.length, setReferenceUploadBusy]
  );

  const handleReferenceDragEnter = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    referenceDragCounterRef.current += 1;
    setReferenceDragActive(true);
  }, []);

  const handleReferenceDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    referenceDragCounterRef.current = Math.max(0, referenceDragCounterRef.current - 1);
    if (referenceDragCounterRef.current === 0) setReferenceDragActive(false);
  }, []);

  const handleReferenceDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleReferenceDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      referenceDragCounterRef.current = 0;
      setReferenceDragActive(false);

      const files = Array.from(event.dataTransfer.files || []).filter((file) => {
        const ext = file.name.toLowerCase();
        return (
          file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(ext)
        );
      });
      if (!files.length) {
        message.error("请拖入 JPG、PNG 或 WebP 图片");
        return;
      }
      void (async () => {
        for (const file of files) {
          await uploadReferenceImage(file);
        }
      })();
    },
    [message, uploadReferenceImage]
  );

  const referenceUploadProps: UploadProps = {
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    showUploadList: false,
    disabled: referenceImages.length >= MAX_REFERENCE_IMAGES,
    customRequest: async ({ file, onSuccess, onError }) => {
      try {
        await uploadReferenceImage(file as File);
        onSuccess?.({});
      } catch (error: unknown) {
        onError?.(error instanceof Error ? error : new Error("上传参考图失败"));
      }
    },
  };

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
          referenceImageUrls: referenceImages.map((item) => item.url),
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
                <Tag>{getAiImageQualityLabel(selectedImage.quality)}</Tag>
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
                {image.quality !== "auto" ? (
                  <Tag>{getAiImageQualityLabel(image.quality)}</Tag>
                ) : null}
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
            <h1 className={styles.title}>AI 图片生成</h1>
            <p className={styles.subtitle}>gpt-image-2 · 历史本地保存 · 可一键转入 AI 视频</p>
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
          <div className={styles.controlPanelBody}>
          <div
            className={styles.referenceSection}
            onDragEnter={handleReferenceDragEnter}
            onDragLeave={handleReferenceDragLeave}
            onDragOver={handleReferenceDragOver}
            onDrop={handleReferenceDrop}
          >
            {referenceDragActive ? (
              <div
                className={styles.referenceDropOverlay}
                onDragOver={handleReferenceDragOver}
                onDrop={handleReferenceDrop}
              >
                <UploadOutlined className={styles.referenceDropIcon} />
                <span className={styles.referenceDropText}>松开上传参考图</span>
              </div>
            ) : null}
            <div className={styles.referenceHeader}>
              <span className={styles.sectionLabel}>参考图</span>
              <span className={styles.referenceHint}>可选 · 点击或拖拽 · 最多 {MAX_REFERENCE_IMAGES} 张</span>
            </div>
            <div
              className={`${styles.referenceStrip} ${
                referenceImages.length === 0 ? styles.referenceStripEmpty : ""
              }`}
            >
              {referenceImages.map((item) => (
                <div key={item.id} className={styles.referenceThumb}>
                  <img src={resolveMediaUrl(item.url)} alt={item.name} />
                  <button
                    type="button"
                    className={styles.referenceRemove}
                    aria-label={`移除参考图 ${item.name}`}
                    onClick={() =>
                      setReferenceImages((prev) => prev.filter((ref) => ref.id !== item.id))
                    }
                  >
                    <DeleteOutlined />
                  </button>
                </div>
              ))}
              {referenceImages.length < MAX_REFERENCE_IMAGES ? (
                <Upload {...referenceUploadProps}>
                  <button
                    type="button"
                    className={styles.referenceAdd}
                    disabled={uploadingReference || referenceImages.length >= MAX_REFERENCE_IMAGES}
                  >
                    {uploadingReference ? (
                      <span className={styles.referenceAddLoading}>
                        <Spin size="small" />
                        <span>上传中</span>
                      </span>
                    ) : (
                      <>
                        <UploadOutlined />
                        <span>上传</span>
                      </>
                    )}
                  </button>
                </Upload>
              ) : null}
            </div>
          </div>

          <div className={styles.sectionDivider} role="separator" />

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
            <div className={styles.sectionHeadRow}>
              <span className={styles.sectionLabel}>输出设置</span>
              <span className={styles.outputMeta}>
                {formatImageSizeLabel(resolvedSize)}
                {aspectRatio !== "auto" ? ` · ${aspectRatio} · ${getResolutionTierLabel(resolution)}` : " · 尺寸自动"}
                {referenceImages.length ? ` · 参考 ${referenceImages.length} 张` : ""}
              </span>
            </div>
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
                  block
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
                  block
                  size="small"
                  value={quality}
                  onChange={(value) => setQuality(normalizeAiImageQuality(value))}
                  options={QUALITY_OPTIONS.map((item) => ({
                    label: item.label,
                    value: item.value,
                  }))}
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
          </div>
          </div>

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
              <h2 className={styles.galleryTitle}>历史记录</h2>
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
