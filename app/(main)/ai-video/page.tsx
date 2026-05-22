"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Alert,
  Button,
  Divider,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Segmented,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  type TableProps,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  LinkOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ScissorOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type { UploadFile, UploadProps } from "antd/es/upload/interface";
import { antdTagPresetStyle, type SemanticTagPreset } from "@/lib/semanticTagStyles";

type GenerationMode = "text" | "first-frame" | "first-last-frame";
type ReferenceKind = "image" | "video" | "audio";

interface SeedanceModelOption {
  label: string;
  value: string;
  generation: string[];
  note: string;
}

interface ClipItem {
  id: string;
  name: string;
  model: string;
  prompt: string;
  mode: GenerationMode;
  status: string;
  taskId?: string;
  videoUrl?: string | null;
  coverUrl?: string | null;
  duration: number;
  ratio: string;
  resolution: string;
  createdAt: string;
  raw?: unknown;
}

interface ReferenceResource {
  id: string;
  name: string;
  kind: ReferenceKind;
  url: string;
  size?: number;
}

const FALLBACK_MODELS: SeedanceModelOption[] = [
  {
    label: "Seedance 2.0",
    value: "doubao-seedance-2-0-260128",
    generation: ["文生视频", "首帧生视频", "首尾帧生视频"],
    note: "质量优先",
  },
  {
    label: "Seedance 2.0 Fast",
    value: "doubao-seedance-2-0-fast-260128",
    generation: ["文生视频", "首帧生视频", "首尾帧生视频"],
    note: "速度优先",
  },
  {
    label: "Seedance 1.5 Pro",
    value: "doubao-seedance-1-5-pro-251215",
    generation: ["文生视频", "首帧生视频"],
    note: "上一代 Pro",
  },
  {
    label: "Seedance 1.0 Pro Fast",
    value: "doubao-seedance-1-0-pro-fast-251015",
    generation: ["文生视频", "首帧生视频"],
    note: "1.0 快速版",
  },
  {
    label: "Seedance 1.0 Pro",
    value: "doubao-seedance-1-0-pro-250528",
    generation: ["文生视频", "首帧生视频"],
    note: "1.0 高质量版",
  },
  {
    label: "Seedance 1.0 Lite T2V",
    value: "doubao-seedance-1-0-lite-t2v-250428",
    generation: ["文生视频"],
    note: "轻量文生视频",
  },
  {
    label: "Seedance 1.0 Lite I2V",
    value: "doubao-seedance-1-0-lite-i2v-250428",
    generation: ["首帧生视频"],
    note: "轻量图生视频",
  },
];

const RATIO_OPTIONS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].map((value) => ({
  label: value,
  value,
}));

const RESOLUTION_OPTIONS = ["480p", "720p", "1080p"].map((value) => ({
  label: value,
  value,
}));

const DURATION_OPTIONS = [5, 6, 8, 10].map((value) => ({
  label: `${value} 秒`,
  value,
}));

const CLIP_CACHE_KEY = "ai-video:seedance-clips";
const REFERENCE_CACHE_KEY = "ai-video:seedance-reference-resources";
const CONFIG_CACHE_KEY = "ai-video:seedance-config";

interface AiVideoCachedConfig {
  model?: string;
  mode?: GenerationMode;
  prompt?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  firstFrameFiles?: UploadFile[];
  lastFrameFiles?: UploadFile[];
  ratio?: string;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  seed?: number | null;
  callbackUrl?: string;
}

function resolveMediaUrl(url?: string | null) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/") && typeof window !== "undefined") {
    return `${window.location.origin}${url}`;
  }
  return url;
}

function isLocalMediaUrl(url: string) {
  const resolved = resolveMediaUrl(url);
  if (!resolved || resolved.startsWith("data:")) return Boolean(resolved);
  if (resolved.startsWith("/")) return true;
  if (typeof window === "undefined") return false;
  try {
    return new URL(resolved).origin === window.location.origin;
  } catch {
    return false;
  }
}

function ClipVideoThumbnail({
  videoUrl,
  coverUrl,
  onClick,
}: {
  videoUrl: string;
  coverUrl?: string | null;
  onClick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(coverUrl ? resolveMediaUrl(coverUrl) : null);

  useEffect(() => {
    if (thumbUrl || !isLocalMediaUrl(videoUrl)) return;
    const video = videoRef.current;
    if (!video) return;

    const captureFrame = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        setThumbUrl(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        // 跨域或未开启 CORS 的视频无法导出 canvas，保留 video 元素作为预览
      }
    };

    const handleLoadedData = () => {
      try {
        video.currentTime = Math.min(0.12, Math.max(0, (video.duration || 0.12) - 0.01));
      } catch {
        captureFrame();
      }
    };

    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("seeked", captureFrame);
    return () => {
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("seeked", captureFrame);
    };
  }, [thumbUrl, videoUrl]);

  return (
    <Tooltip title="点击预览视频">
      <button
        type="button"
        aria-label="预览视频"
        onClick={onClick}
        style={{
          position: "relative",
          width: 72,
          height: 48,
          padding: 0,
          border: "1px solid var(--vol-hairline)",
          borderRadius: 6,
          overflow: "hidden",
          cursor: "pointer",
          background: "#111",
        }}
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt="视频首帧" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <video
            ref={videoRef}
            src={resolveMediaUrl(videoUrl)}
            preload="metadata"
            muted
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
          />
        )}
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.28)",
            color: "#fff",
            fontSize: 18,
          }}
        >
          <PlayCircleOutlined />
        </span>
      </button>
    </Tooltip>
  );
}

const pageWrapStyle: React.CSSProperties = {
  width: "100%",
};

const sectionStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--vol-hairline)",
  borderRadius: 8,
  background: "var(--vol-canvas-soft)",
  padding: 16,
};

function readCachedClips(): ClipItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CLIP_CACHE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readCachedReferenceResources(): ReferenceResource[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REFERENCE_CACHE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readCachedConfig(): AiVideoCachedConfig {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONFIG_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isGenerationMode(value: unknown): value is GenerationMode {
  return value === "text" || value === "first-frame" || value === "first-last-frame";
}

function readCachedUploadFiles(value: unknown): UploadFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && typeof item.uid === "string")
    .slice(0, 1)
    .map((item: any) => ({
      uid: item.uid,
      name: String(item.name || "已上传文件"),
      status: item.status === "done" ? "done" : undefined,
      url: typeof item.url === "string" ? item.url : undefined,
      thumbUrl: typeof item.thumbUrl === "string" ? item.thumbUrl : undefined,
    }));
}

function createReferenceId() {
  return `ref-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getReferenceKind(file: File): ReferenceKind | null {
  const ext = file.name.toLowerCase();
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type) || /\.(jpe?g|png|webp)$/.test(ext)) {
    return "image";
  }
  if (
    ["video/mp4", "video/quicktime", "video/webm"].includes(file.type) ||
    /\.(mp4|mov|webm)$/.test(ext)
  ) {
    return "video";
  }
  if (
    ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac"].includes(file.type) ||
    /\.(mp3|wav|m4a|aac)$/.test(ext)
  ) {
    return "audio";
  }
  return null;
}

function getReferenceKindLabel(kind: ReferenceKind) {
  if (kind === "image") return "图片";
  if (kind === "video") return "视频";
  return "音频";
}

function formatFileSize(size?: number) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function normalizeReferencePrompt(value: string) {
  return value.replace(/@(图片|视频|音频)\s*(\d+)/g, "$1$2");
}

function getFirstImageReference(resources: ReferenceResource[]) {
  return resources.find((item) => item.kind === "image");
}

function getStatusPreset(status: string): SemanticTagPreset {
  const normalized = status.toLowerCase();
  if (["succeeded", "success", "completed", "done"].includes(normalized)) return "success";
  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) return "error";
  if (["queued", "created", "pending"].includes(normalized)) return "default";
  if (["running", "processing", "in_progress", "in-progress"].includes(normalized)) return "processing";
  return "default";
}

function formatClipStatusLabel(status: string) {
  const normalized = status.toLowerCase();
  const labels: Record<string, string> = {
    running: "生成中",
    processing: "生成中",
    in_progress: "生成中",
    "in-progress": "生成中",
    queued: "排队中",
    created: "已创建",
    pending: "待生成",
    succeeded: "已完成",
    success: "已完成",
    completed: "已完成",
    done: "已完成",
    failed: "失败",
    error: "失败",
    cancelled: "已取消",
    canceled: "已取消",
    unknown: "未知",
  };
  return labels[normalized] || status || "未知";
}

function isFinished(status: string) {
  return ["succeeded", "success", "completed", "done", "failed", "error", "cancelled", "canceled"].includes(
    status.toLowerCase()
  );
}

function createClipId() {
  return `clip-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function AiVideoPage() {
  const { message } = App.useApp();
  const cachedConfig = useMemo(() => readCachedConfig(), []);
  const [models, setModels] = useState<SeedanceModelOption[]>(FALLBACK_MODELS);
  const [hasServerApiKey, setHasServerApiKey] = useState(false);
  const [showCallbackUrl, setShowCallbackUrl] = useState(false);
  const [model, setModel] = useState(cachedConfig.model || FALLBACK_MODELS[0].value);
  const [mode, setMode] = useState<GenerationMode>(
    isGenerationMode(cachedConfig.mode) ? cachedConfig.mode : "first-frame"
  );
  const [prompt, setPrompt] = useState(cachedConfig.prompt || "");
  const [firstFrameUrl, setFirstFrameUrl] = useState(cachedConfig.firstFrameUrl || "");
  const [lastFrameUrl, setLastFrameUrl] = useState(cachedConfig.lastFrameUrl || "");
  const [firstFrameFiles, setFirstFrameFiles] = useState<UploadFile[]>(() =>
    readCachedUploadFiles(cachedConfig.firstFrameFiles)
  );
  const [lastFrameFiles, setLastFrameFiles] = useState<UploadFile[]>(() =>
    readCachedUploadFiles(cachedConfig.lastFrameFiles)
  );
  const [referenceResources, setReferenceResources] = useState<ReferenceResource[]>(() =>
    readCachedReferenceResources()
  );
  const [ratio, setRatio] = useState(cachedConfig.ratio || "9:16");
  const [resolution, setResolution] = useState(cachedConfig.resolution || "720p");
  const [duration, setDuration] = useState(cachedConfig.duration || 5);
  const [generateAudio, setGenerateAudio] = useState(cachedConfig.generateAudio ?? false);
  const [watermark, setWatermark] = useState(cachedConfig.watermark ?? false);
  const [seed, setSeed] = useState<number | null>(
    typeof cachedConfig.seed === "number" ? cachedConfig.seed : null
  );
  const [callbackUrl, setCallbackUrl] = useState(cachedConfig.callbackUrl || "");
  const [clips, setClips] = useState<ClipItem[]>(() => readCachedClips());
  const [selectedClipIds, setSelectedClipIds] = useState<React.Key[]>([]);
  const [pageReady, setPageReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pollingTaskIds, setPollingTaskIds] = useState<Set<string>>(new Set());
  const [uploadingClip, setUploadingClip] = useState(false);
  const [uploadingReference, setUploadingReference] = useState(false);
  const [composing, setComposing] = useState(false);
  const [filmUrl, setFilmUrl] = useState<string | null>(null);
  const [previewClip, setPreviewClip] = useState<ClipItem | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  const [promptAtIndex, setPromptAtIndex] = useState<number | null>(null);
  const promptTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragCounterRef = useRef(0);
  const clipsRef = useRef<ClipItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai-video/seedance", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.models) && data.models.length) setModels(data.models);
        setHasServerApiKey(Boolean(data.hasServerApiKey));
        if (Boolean(data.showCallbackUrl)) {
          setShowCallbackUrl(true);
          if (!cachedConfig.callbackUrl && typeof data.defaultCallbackUrl === "string" && data.defaultCallbackUrl.trim()) {
            setCallbackUrl(data.defaultCallbackUrl.trim());
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPageReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cachedConfig.callbackUrl]);

  useEffect(() => {
    clipsRef.current = clips;
    try {
      window.localStorage.setItem(CLIP_CACHE_KEY, JSON.stringify(clips));
    } catch {}
  }, [clips]);

  useEffect(() => {
    try {
      window.localStorage.setItem(REFERENCE_CACHE_KEY, JSON.stringify(referenceResources));
    } catch {}
  }, [referenceResources]);

  useEffect(() => {
    const config: AiVideoCachedConfig = {
      model,
      mode,
      prompt,
      firstFrameUrl,
      lastFrameUrl,
      firstFrameFiles: firstFrameFiles.map((file) => ({
        uid: file.uid,
        name: file.name,
        status: file.status,
        url: file.url,
        thumbUrl: file.thumbUrl,
      })),
      lastFrameFiles: lastFrameFiles.map((file) => ({
        uid: file.uid,
        name: file.name,
        status: file.status,
        url: file.url,
        thumbUrl: file.thumbUrl,
      })),
      ratio,
      resolution,
      duration,
      generateAudio,
      watermark,
      seed,
      callbackUrl,
    };
    try {
      window.localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
    } catch {}
  }, [
    callbackUrl,
    duration,
    firstFrameFiles,
    firstFrameUrl,
    generateAudio,
    lastFrameFiles,
    lastFrameUrl,
    mode,
    model,
    prompt,
    ratio,
    resolution,
    seed,
    watermark,
  ]);

  const selectedModel = useMemo(
    () => models.find((item) => item.value === model) || models[0],
    [model, models]
  );

  const modelOptions = useMemo(
    () =>
      models.map((item) => ({
        label: `${item.label} · ${item.note}`,
        value: item.value,
      })),
    [models]
  );

  const selectedClips = useMemo(() => {
    const selected = new Set(selectedClipIds.map(String));
    return clips.filter((clip) => selected.has(clip.id) && clip.videoUrl);
  }, [clips, selectedClipIds]);

  const selectedDuration = selectedClips.reduce((sum, item) => sum + (item.duration || 0), 0);

  const updateClip = useCallback((id: string, patch: Partial<ClipItem>) => {
    setClips((prev) => prev.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)));
  }, []);

  const pollTask = useCallback(
    async (clipId: string, taskId: string) => {
      try {
        const res = await fetch(`/api/ai-video/seedance/${encodeURIComponent(taskId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "查询任务失败");

        const task = data.task || {};
        updateClip(clipId, {
          status: task.status || "unknown",
          videoUrl: task.videoUrl || undefined,
          coverUrl: task.coverUrl || undefined,
          raw: task.raw,
        });

        if (isFinished(task.status || "")) {
          setPollingTaskIds((prev) => {
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
        }
      } catch (e: any) {
        message.error(e.message || "查询任务失败");
      }
    },
    [message, updateClip]
  );

  useEffect(() => {
    if (!pollingTaskIds.size) return;
    const timer = window.setInterval(() => {
      const liveClips = clipsRef.current;
      pollingTaskIds.forEach((taskId) => {
        const clip = liveClips.find((item) => item.taskId === taskId);
        if (clip && !isFinished(clip.status)) pollTask(clip.id, taskId);
      });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [pollTask, pollingTaskIds]);

  async function submitTask() {
    if (!hasServerApiKey) {
      message.warning("请先在环境变量中配置 VOLCENGINE_ARK_API_KEY 或 ARK_API_KEY");
      return;
    }
    if (!prompt.trim()) {
      message.warning("请先输入提示词");
      return;
    }
    const firstFrameReference = mode === "first-frame" ? getFirstImageReference(referenceResources) : null;
    const resolvedFirstFrameUrl = mode === "first-frame" ? firstFrameReference?.url || "" : firstFrameUrl;
    const requestMode = mode === "first-frame" && !resolvedFirstFrameUrl ? "text" : mode;
    const resolvedReferenceResources = mode === "first-last-frame" ? [] : referenceResources;

    if (mode === "first-frame" && !referenceResources.length) {
      message.warning("请先上传图片、视频或音频资源");
      return;
    }
    if (mode === "first-last-frame" && !firstFrameUrl.trim()) {
      message.warning("请上传首帧图片");
      return;
    }
    if (mode === "first-last-frame" && !lastFrameUrl.trim()) {
      message.warning("请上传尾帧图片");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/ai-video/seedance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: normalizeReferencePrompt(prompt),
          mode: requestMode,
          firstFrameUrl: resolvedFirstFrameUrl,
          lastFrameUrl,
          referenceResources: resolvedReferenceResources
            .filter((resource) => !(mode === "first-frame" && resource.id === firstFrameReference?.id))
            .map((resource) => ({
              id: resource.id,
              name: resource.name,
              kind: resource.kind,
              url: resource.url,
            })),
          ratio,
          resolution,
          duration,
          generateAudio,
          watermark,
          seed,
          callbackUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建任务失败");

      const task = data.task || {};
      const taskId = task.id || data.raw?.id || data.raw?.task_id;
      const clip: ClipItem = {
        id: createClipId(),
        name: prompt.trim().slice(0, 24) || "未命名片段",
        model,
        prompt,
        mode,
        status: task.status || "created",
        taskId,
        videoUrl: task.videoUrl,
        coverUrl: task.coverUrl,
        duration,
        ratio,
        resolution,
        createdAt: new Date().toISOString(),
        raw: task.raw || data.raw,
      };

      setClips((prev) => [clip, ...prev]);
      if (taskId && !isFinished(clip.status)) {
        setPollingTaskIds((prev) => new Set(prev).add(taskId));
      }
      message.success("Seedance 任务已创建");
    } catch (e: any) {
      message.error(e.message || "创建任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  const uploadClipVideo = useCallback(
    async (file: File) => {
      const isVideo = ["video/mp4", "video/quicktime", "video/webm"].includes(file.type);
      const ext = file.name.toLowerCase();
      const byExt = [".mp4", ".mov", ".webm"].some((item) => ext.endsWith(item));
      if (!isVideo && !byExt) {
        message.error("仅支持 MP4、MOV、WebM 视频");
        return;
      }
      if (file.size / 1024 / 1024 > 200) {
        message.error("视频不能超过 200MB");
        return;
      }

      setUploadingClip(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/ai-video/upload", { method: "POST", body: formData });
        const data = (await res.json()) as { url?: string; name?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error || "上传视频失败");

        const clipId = createClipId();
        const clip: ClipItem = {
          id: clipId,
          name: data.name?.replace(/\.[^.]+$/, "") || `上传片段 ${clips.length + 1}`,
          model: "manual",
          prompt: "",
          mode: "text",
          status: "completed",
          videoUrl: data.url,
          duration,
          ratio,
          resolution,
          createdAt: new Date().toISOString(),
        };
        setClips((prev) => [clip, ...prev]);
        setSelectedClipIds((prev) => [...prev, clipId]);
        message.success("片段已上传并加入列表");
      } catch (e: any) {
        message.error(e.message || "上传视频失败");
      } finally {
        setUploadingClip(false);
      }
    },
    [clips.length, duration, message, ratio, resolution]
  );

  const clipUploadProps: UploadProps = {
    accept: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm",
    maxCount: 1,
    showUploadList: false,
    disabled: uploadingClip,
    beforeUpload(file) {
      void uploadClipVideo(file);
      return false;
    },
  };

  const uploadReferenceResource = useCallback(
    async (file: File) => {
      const kind = getReferenceKind(file);
      if (!kind) {
        message.error("仅支持 JPG、PNG、WebP 图片，MP4、MOV、WebM 视频，或 MP3、WAV、M4A、AAC 音频");
        return;
      }

      const maxMb = kind === "video" ? 200 : kind === "audio" ? 80 : 12;
      if (file.size / 1024 / 1024 > maxMb) {
        message.error(`${getReferenceKindLabel(kind)}不能超过 ${maxMb}MB`);
        return;
      }

      setUploadingReference(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/ai-video/upload", { method: "POST", body: formData });
        const data = (await res.json()) as {
          url?: string;
          name?: string;
          size?: number;
          kind?: ReferenceKind;
          error?: string;
        };
        if (!res.ok || !data.url) throw new Error(data.error || "上传参考资源失败");
        const uploadedUrl = data.url;

        setReferenceResources((prev) => [
          ...prev,
          {
            id: createReferenceId(),
            name: data.name || file.name,
            kind: (data.kind || kind) as ReferenceKind,
            url: uploadedUrl,
            size: data.size || file.size,
          },
        ]);
        message.success("参考资源已上传");
      } catch (e: any) {
        message.error(e.message || "上传参考资源失败");
      } finally {
        setUploadingReference(false);
      }
    },
    [message]
  );

  const referenceUploadProps: UploadProps = {
    accept:
      "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.mp3,.wav,.m4a,.aac",
    multiple: true,
    showUploadList: false,
    disabled: uploadingReference,
    beforeUpload(file) {
      void uploadReferenceResource(file);
      return false;
    },
  };

  const firstFrameUnifiedUploadProps: UploadProps = {
    ...referenceUploadProps,
    maxCount: 1,
    multiple: false,
  };

  function getReferenceLabel(resource: ReferenceResource) {
    const sameKindResources = referenceResources.filter((item) => item.kind === resource.kind);
    const index = sameKindResources.findIndex((item) => item.id === resource.id) + 1;
    return `${getReferenceKindLabel(resource.kind)}${Math.max(1, index)}`;
  }

  function insertReferenceToken(resource: ReferenceResource) {
    const token = `@${getReferenceLabel(resource)}`;
    setPrompt((prev) => {
      const base = prev.trimEnd();
      return base ? `${base} ${token}` : token;
    });
    message.success(`已插入 ${token}`);
  }

  function insertReferenceTokenAtPrompt(resource: ReferenceResource) {
    const token = `@${getReferenceLabel(resource)}`;
    const textarea = promptTextAreaRef.current;
    const selectionStart = textarea?.selectionStart ?? prompt.length;
    const atIndex = promptAtIndex ?? Math.max(0, selectionStart - 1);
    const before = prompt.slice(0, atIndex);
    const afterRaw = prompt.slice(selectionStart);
    const after = afterRaw.startsWith(" ") || !afterRaw ? afterRaw : ` ${afterRaw}`;
    const nextPrompt = `${before}${token}${after}`;
    setPrompt(nextPrompt);
    setResourcePickerOpen(false);
    setPromptAtIndex(null);

    window.requestAnimationFrame(() => {
      const caret = before.length + token.length;
      promptTextAreaRef.current?.focus();
      promptTextAreaRef.current?.setSelectionRange(caret, caret);
    });
  }

  function handlePromptChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;
    const cursor = event.target.selectionStart ?? nextValue.length;
    setPrompt(nextValue);

    const charBeforeCursor = nextValue[cursor - 1];
    if (charBeforeCursor === "@" && referenceResources.length) {
      setPromptAtIndex(cursor - 1);
      setResourcePickerOpen(true);
      return;
    }

    if (resourcePickerOpen && promptAtIndex != null) {
      const activeToken = nextValue.slice(promptAtIndex, cursor);
      if (!activeToken.startsWith("@") || /\s/.test(activeToken.slice(1))) {
        setResourcePickerOpen(false);
        setPromptAtIndex(null);
      }
    }
  }

  function removeReferenceResource(id: string) {
    setReferenceResources((prev) => prev.filter((item) => item.id !== id));
    message.success("已移除参考资源");
  }

  function renderReferenceResourcesList() {
    if (!referenceResources.length) return null;

    return (
      <Space wrap size={8}>
        {referenceResources.map((resource) => {
          const label = getReferenceLabel(resource);
          const token = `@${label}`;
          return (
            <div
              key={resource.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                maxWidth: 360,
                padding: "6px 8px",
                border: "1px solid var(--vol-hairline)",
                borderRadius: 8,
                background: "var(--vol-canvas)",
              }}
            >
              {resource.kind === "image" ? (
                <img
                  src={resource.url}
                  alt={resource.name}
                  style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
                />
              ) : (
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 4,
                    background: "#111",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontSize: 16,
                  }}
                >
                  {resource.kind === "video" ? <PlayCircleOutlined /> : <PaperClipOutlined />}
                </div>
              )}
              <Button size="small" type="link" onClick={() => insertReferenceToken(resource)}>
                {token}
              </Button>
              <Typography.Text type="secondary" style={{ maxWidth: 150, fontSize: 12 }} ellipsis>
                {resource.name}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                {formatFileSize(resource.size)}
              </Typography.Text>
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                aria-label={`删除${label}`}
                onClick={() => removeReferenceResource(resource.id)}
              />
            </div>
          );
        })}
      </Space>
    );
  }

  function moveClip(id: string, direction: -1 | 1) {
    setClips((prev) => {
      const index = prev.findIndex((clip) => clip.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      message.success(direction < 0 ? "片段已上移" : "片段已下移");
      return next;
    });
  }

  async function composeFilm() {
    if (selectedClips.length < 2) {
      message.warning("至少选择 2 个已有视频 URL 的片段");
      return;
    }
    setComposing(true);
    try {
      const res = await fetch("/api/ai-video/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: selectedClips.map((clip) => ({
            id: clip.id,
            name: clip.name,
            videoUrl: clip.videoUrl,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "合成视频失败");
      setFilmUrl(data.videoUrl);
      message.success("成片已合成");
    } catch (e: any) {
      message.error(e.message || "合成视频失败");
    } finally {
      setComposing(false);
    }
  }

  async function downloadClip(record: ClipItem) {
    if (!record.videoUrl) {
      message.warning("视频尚未就绪");
      return;
    }
    const url = resolveMediaUrl(record.videoUrl);
    const filename = `${record.name.replace(/[^\w\u4e00-\u9fa5.-]+/g, "_") || "clip"}.mp4`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("下载失败");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
      message.success("视频已开始下载");
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
      message.info("已在新标签页打开，可右键保存视频");
    }
  }

  async function copyFilmPlan() {
    const lines = selectedClips.map((clip, index) => `${index + 1}. ${clip.name} ${clip.videoUrl}`);
    await navigator.clipboard.writeText(lines.join("\n"));
    message.success("已复制成片清单");
  }

  async function copyPrompt(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制提示词");
    } catch {
      message.error("复制失败，请手动选择复制");
    }
  }

  const validateFrameFile = useCallback(
    (file: File) => {
      const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
      if (!isImage) {
        message.error("仅支持 JPG、PNG、WebP 图片");
        return false;
      }
      if (file.size / 1024 / 1024 > 12) {
        message.error("图片不能超过 12MB");
        return false;
      }
      return true;
    },
    [message]
  );

  const uploadFrameImage = useCallback(
    async (
      file: File,
      target: "first" | "last",
      setFileList: (files: UploadFile[]) => void,
      setUrl: (url: string) => void
    ) => {
      if (!validateFrameFile(file)) return;

      const uid = `frame-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setFileList([{ uid, name: file.name, status: "uploading" }]);

      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/ai-video/upload", { method: "POST", body: formData });
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error || "上传图片失败");

        setUrl(data.url);
        setFileList([
          {
            uid,
            name: file.name,
            status: "done",
            url: data.url,
            thumbUrl: data.url,
          },
        ]);
        message.success(target === "first" ? "首帧图片已上传" : "尾帧图片已上传");
      } catch (e: any) {
        setFileList([]);
        message.error(e.message || "上传图片失败");
      }
    },
    [message, validateFrameFile]
  );

  const clearFrameUpload = useCallback((target: "first" | "last") => {
    if (target === "first") {
      setFirstFrameUrl("");
      setFirstFrameFiles([]);
      return;
    }
    setLastFrameUrl("");
    setLastFrameFiles([]);
  }, []);

  const buildFrameUploadProps = (
    target: "first" | "last",
    fileList: UploadFile[],
    setFileList: (files: UploadFile[]) => void,
    setUrl: (url: string) => void
  ): UploadProps => ({
    accept: "image/png,image/jpeg,image/webp",
    maxCount: 1,
    fileList,
    showUploadList: false,
    customRequest: async ({ file, onSuccess, onError }) => {
      try {
        await uploadFrameImage(file as File, target, setFileList, setUrl);
        onSuccess?.({});
      } catch (e: any) {
        onError?.(e);
      }
    },
    beforeUpload(file) {
      return validateFrameFile(file) ? true : Upload.LIST_IGNORE;
    },
    onRemove() {
      clearFrameUpload(target);
    },
  });

  const framePreviewStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 12px",
    border: "1px solid var(--vol-hairline)",
    borderRadius: 8,
    background: "var(--vol-canvas)",
  };

  function renderFrameUploadButton(
    target: "first" | "last",
    label: string,
    url: string,
    fileList: UploadFile[],
    setFileList: (files: UploadFile[]) => void,
    setUrl: (url: string) => void
  ) {
    return (
      <Upload {...buildFrameUploadProps(target, fileList, setFileList, setUrl)}>
        <Button icon={<UploadOutlined />}>{url ? `重新上传${label}` : `上传${label}`}</Button>
      </Upload>
    );
  }

  function renderFramePreview(target: "first" | "last", label: string, url: string, fileList: UploadFile[]) {
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
          onClick={() => clearFrameUpload(target)}
        />
      </div>
    );
  }

  const handleFrameDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current += 1;
    if (event.dataTransfer.types.includes("Files")) setDragActive(true);
  }, []);

  const handleFrameDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragActive(false);
  }, []);

  const handleFrameDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleFrameDrop = useCallback(
    (event: React.DragEvent, target: "first" | "last") => {
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = 0;
      setDragActive(false);

      const file = event.dataTransfer.files?.[0];
      if (!file) return;

      if (target === "first") {
        void uploadFrameImage(file, "first", setFirstFrameFiles, setFirstFrameUrl);
        return;
      }
      void uploadFrameImage(file, "last", setLastFrameFiles, setLastFrameUrl);
    },
    [uploadFrameImage]
  );

  const columns: TableProps<ClipItem>["columns"] = [
    {
      title: "片段",
      dataIndex: "name",
      width: 240,
      render: (_, record) => {
        const meta = `${record.ratio} · ${record.resolution} · ${record.duration}s`;
        const tooltipContent = `${record.name}\n${meta}`;

        return (
          <Tooltip
            title={<span style={{ whiteSpace: "pre-wrap" }}>{tooltipContent}</span>}
            styles={{ root: { maxWidth: 420 } }}
          >
            <Space orientation="vertical" size={2} style={{ maxWidth: 210 }}>
              <Typography.Text strong ellipsis>
                {record.name}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {meta}
              </Typography.Text>
            </Space>
          </Tooltip>
        );
      },
    },
    {
      title: "模型",
      dataIndex: "model",
      width: 190,
      render: (value) => (
        <Typography.Text style={{ fontSize: 12 }} ellipsis>
          {value}
        </Typography.Text>
      ),
    },
    {
      title: "提示词",
      dataIndex: "prompt",
      width: 260,
      render: (value) => {
        const prompt = String(value || "").trim();
        if (!prompt) {
          return (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              —
            </Typography.Text>
          );
        }
        return (
          <Tooltip
            title={
              <span style={{ whiteSpace: "pre-wrap" }}>
                {prompt}
                <br />
                （点击复制）
              </span>
            }
            styles={{ root: { maxWidth: 480 } }}
          >
            <Typography.Text
              style={{ fontSize: 12, maxWidth: 240, cursor: "copy" }}
              ellipsis
              onClick={() => void copyPrompt(prompt)}
            >
              {prompt}
            </Typography.Text>
          </Tooltip>
        );
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value) => {
        const status = String(value || "unknown");
        return (
          <Tag style={{ ...antdTagPresetStyle(getStatusPreset(status)), margin: 0 }}>
            {formatClipStatusLabel(status)}
          </Tag>
        );
      },
    },
    {
      title: "视频",
      dataIndex: "videoUrl",
      width: 88,
      render: (_, record) =>
        record.videoUrl ? (
          <ClipVideoThumbnail
            videoUrl={record.videoUrl}
            coverUrl={record.coverUrl}
            onClick={() => setPreviewClip(record)}
          />
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            等待
          </Typography.Text>
        ),
    },
    {
      title: "操作",
      key: "actions",
      width: 230,
      render: (_, record) => {
        const clipIndex = clips.findIndex((clip) => clip.id === record.id);
        const isFirst = clipIndex <= 0;
        const isLast = clipIndex < 0 || clipIndex >= clips.length - 1;

        return (
          <Space size={4} wrap>
            <Tooltip title={isFirst ? "已在最前" : "上移，调整合成顺序"}>
              <Button
                size="small"
                icon={<ArrowUpOutlined />}
                disabled={isFirst}
                aria-label="上移片段"
                onClick={() => moveClip(record.id, -1)}
              />
            </Tooltip>
            <Tooltip title={isLast ? "已在最后" : "下移，调整合成顺序"}>
              <Button
                size="small"
                icon={<ArrowDownOutlined />}
                disabled={isLast}
                aria-label="下移片段"
                onClick={() => moveClip(record.id, 1)}
              />
            </Tooltip>
            {record.taskId && !isFinished(record.status) ? (
              <Tooltip title="刷新 Seedance 任务状态">
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  aria-label="刷新任务状态"
                  onClick={() => pollTask(record.id, record.taskId!)}
                />
              </Tooltip>
            ) : null}
            {record.videoUrl ? (
              <Tooltip title="下载视频">
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  aria-label="下载视频"
                  onClick={() => void downloadClip(record)}
                />
              </Tooltip>
            ) : null}
            <Tooltip title="从列表移除">
              <Button
                danger
                size="small"
                icon={<DeleteOutlined />}
                aria-label="删除片段"
                onClick={() => {
                  setClips((prev) => prev.filter((clip) => clip.id !== record.id));
                  setSelectedClipIds((prev) => prev.filter((id) => id !== record.id));
                  message.success("已移除片段");
                }}
              />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={pageWrapStyle}>
      {!pageReady ? (
        <div
          style={{
            width: "100%",
            minHeight: 560,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Spin size="large" description="加载中..." />
        </div>
      ) : (
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0, fontSize: 18 }}>
            AI 视频生成
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            接入火山 Seedance 模型，生成片段后在列表里选择并组合成片
          </Typography.Text>
        </div>

        <section
          style={{ ...sectionStyle, position: "relative" }}
          onDragEnter={mode === "first-last-frame" ? handleFrameDragEnter : undefined}
          onDragLeave={mode === "first-last-frame" ? handleFrameDragLeave : undefined}
          onDragOver={mode === "first-last-frame" ? handleFrameDragOver : undefined}
        >
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
                  onDragOver={handleFrameDragOver}
                  onDrop={(event) => handleFrameDrop(event, "first")}
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
                  onDragOver={handleFrameDragOver}
                  onDrop={(event) => handleFrameDrop(event, "last")}
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
              <div style={{ position: "relative", width: "100%" }}>
                <Input.TextArea
                  ref={(node) => {
                    promptTextAreaRef.current = node?.resizableTextArea?.textArea || null;
                  }}
                  value={prompt}
                  onChange={handlePromptChange}
                  onBlur={() => {
                    window.setTimeout(() => setResourcePickerOpen(false), 160);
                  }}
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
                    }}
                  >
                    <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                      {referenceResources.map((resource) => {
                        const label = getReferenceLabel(resource);
                        return (
                          <button
                            key={resource.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => insertReferenceTokenAtPrompt(resource)}
                            style={{
                              width: "100%",
                              border: 0,
                              borderRadius: 6,
                              padding: "7px 8px",
                              background: "transparent",
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
                                {resource.kind === "video" ? <PlayCircleOutlined /> : <PaperClipOutlined />}
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
              <Typography.Text
                type="secondary"
                style={{ alignSelf: "flex-end", fontSize: 12, lineHeight: "18px" }}
              >
                {prompt.length} / 1800
              </Typography.Text>
            </Space>

            {mode === "first-frame" ? (
              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                <Space wrap align="center" size={8}>
                  <Upload {...firstFrameUnifiedUploadProps}>
                    <Button icon={<PaperClipOutlined />} loading={uploadingReference}>
                      上传资源
                    </Button>
                  </Upload>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    支持图片、视频、音频；第一张图片会作为首帧，点击资源标签可插入 @图片1、@视频1、@音频1
                  </Typography.Text>
                </Space>
                {renderReferenceResourcesList()}
              </Space>
            ) : null}

            {mode === "first-last-frame" ? (
              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                <Space wrap size={8} align="center">
                  {renderFrameUploadButton(
                    "first",
                    "首帧图片",
                    firstFrameUrl,
                    firstFrameFiles,
                    setFirstFrameFiles,
                    setFirstFrameUrl
                  )}
                  {renderFrameUploadButton(
                    "last",
                    "尾帧图片",
                    lastFrameUrl,
                    lastFrameFiles,
                    setLastFrameFiles,
                    setLastFrameUrl
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    首尾帧模式仅支持上传首帧图和尾帧图
                  </Typography.Text>
                </Space>
                {firstFrameUrl || lastFrameUrl ? (
                  <Space wrap size={12} align="start">
                    {renderFramePreview("first", "首帧图片", firstFrameUrl, firstFrameFiles)}
                    {renderFramePreview("last", "尾帧图片", lastFrameUrl, lastFrameFiles)}
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
                <Select
                  value={resolution}
                  onChange={setResolution}
                  options={RESOLUTION_OPTIONS}
                  style={{ width: 120 }}
                />
              </Space>
              <Space orientation="vertical" size={4}>
                <Typography.Text strong>时长</Typography.Text>
                <Select
                  value={duration}
                  onChange={setDuration}
                  options={DURATION_OPTIONS}
                  style={{ width: 110 }}
                />
              </Space>
              <Space orientation="vertical" size={4}>
                <Typography.Text strong>声音</Typography.Text>
                <Switch
                  checked={generateAudio}
                  checkedChildren="有"
                  unCheckedChildren="无"
                  onChange={setGenerateAudio}
                />
              </Space>
              <Space orientation="vertical" size={4}>
                <Typography.Text strong>水印</Typography.Text>
                <Switch
                  checked={watermark}
                  checkedChildren="开"
                  unCheckedChildren="关"
                  onChange={setWatermark}
                />
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
                    onChange={(value) =>
                      setSeed(typeof value === "number" && Number.isFinite(value) ? value : null)
                    }
                    style={{ width: 118 }}
                  />
                  <Button onClick={() => setSeed(null)}>随机</Button>
                </Space.Compact>
              </Space>
            </Space>

            {showCallbackUrl ? (
              <Input
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder="Callback URL（可选）"
              />
            ) : null}

            <Space>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={submitting}
                onClick={submitTask}
              >
                生成片段
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                默认关闭水印；生成后会自动轮询任务状态
              </Typography.Text>
            </Space>
          </Space>
        </section>

        <section style={sectionStyle}>
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <Space align="center" style={{ width: "100%", justifyContent: "space-between" }}>
              <div>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  片段列表
                </Typography.Text>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    按列表顺序组合成片，勾选需要进入成片的片段；操作列可调整顺序、刷新任务或删除
                  </Typography.Text>
                </div>
              </div>
              <Space>
                <Button icon={<CopyOutlined />} onClick={copyFilmPlan} disabled={!selectedClips.length}>
                  复制清单
                </Button>
                <Upload {...clipUploadProps}>
                  <Button icon={<UploadOutlined />} loading={uploadingClip}>
                    上传片段
                  </Button>
                </Upload>
                <Button
                  type="primary"
                  icon={<ScissorOutlined />}
                  loading={composing}
                  disabled={selectedClips.length < 2}
                  onClick={composeFilm}
                >
                  合成成片
                </Button>
              </Space>
            </Space>

            {clips.length ? (
              <Table
                rowKey="id"
                size="small"
                pagination={{ pageSize: 8 }}
                dataSource={clips}
                columns={columns}
                rowSelection={{
                  selectedRowKeys: selectedClipIds,
                  onChange: setSelectedClipIds,
                  getCheckboxProps: (record) => ({ disabled: !record.videoUrl }),
                }}
              />
            ) : (
              <Empty description="还没有片段" />
            )}

            <Alert
              type="info"
              showIcon
              title={`已选 ${selectedClips.length} 个片段，预计 ${selectedDuration || 0} 秒`}
            />

            {filmUrl ? (
              <>
                <Divider style={{ margin: "8px 0" }} />
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                  <Typography.Text strong>成片预览</Typography.Text>
                  <video
                    controls
                    src={filmUrl}
                    style={{
                      width: "100%",
                      maxWidth: 520,
                      borderRadius: 8,
                      border: "1px solid var(--vol-hairline)",
                      background: "#000",
                    }}
                  />
                  <Button icon={<LinkOutlined />} href={filmUrl} target="_blank">
                    打开成片
                  </Button>
                </Space>
              </>
            ) : null}
          </Space>
        </section>
        </Space>
      )}

      <Modal
        open={Boolean(previewClip)}
        destroyOnHidden
        title={previewClip?.name || "视频预览"}
        footer={null}
        width={760}
        onCancel={() => setPreviewClip(null)}
      >
        {previewClip?.videoUrl ? (
          <video
            key={previewClip.id}
            controls
            autoPlay
            src={resolveMediaUrl(previewClip.videoUrl)}
            style={{
              width: "100%",
              maxHeight: "70vh",
              borderRadius: 8,
              background: "#000",
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
