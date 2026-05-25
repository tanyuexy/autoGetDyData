import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Upload, type UploadProps } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import type { AiVideoComposedFilm } from "@/types";
import type { ComposeFilmModalResult } from "@/components/ComposeFilmModal";
import { buildClipTableColumns } from "@/components/ai-video/clipTableColumns";
import { buildFilmTableColumns } from "@/components/ai-video/filmTableColumns";
import {
  deleteClipFromServer,
  deleteFilmFromServer,
  fetchClipsFromServer,
  fetchFilmsFromServer,
  saveClipToServer,
} from "@/lib/ai-video/api";
import {
  clearLegacyClipsCache,
  clearReferenceResourcesCache,
  isGenerationMode,
  readCachedConfig,
  readCachedReferenceResources,
  readCachedUploadFiles,
  readLegacyCachedClips,
  serializeUploadFiles,
  writeReferenceResourcesCache,
  writeStoredConfig,
} from "@/lib/ai-video/cache";
import { FALLBACK_MODELS, REFERENCE_CACHE_KEY } from "@/lib/ai-video/constants";
import {
  buildClipFormSnapshot,
  createClipId,
  createReferenceId,
  ensureUploadFilesFromUrl,
  getFirstImageReference,
  getReferenceLabel,
  isFinished,
  normalizeReferencePrompt,
  resolveClipRestoreSnapshot,
  validateReferenceFile,
} from "@/lib/ai-video/clipUtils";
import { resolveMediaUrl } from "@/lib/ai-video/media";
import type { ClipItem, GenerationMode, ReferenceKind, ReferenceResource, SeedanceModelOption } from "@/lib/ai-video/types";
import {
  getSeedanceDurationConfig,
  normalizeSeedanceDuration,
} from "@/lib/volcengineSeedanceDuration";

export function useAiVideoPage() {
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
const [duration, setDuration] = useState(() =>
  normalizeSeedanceDuration(cachedConfig.model || FALLBACK_MODELS[0].value, cachedConfig.duration)
);
const [generateAudio, setGenerateAudio] = useState(cachedConfig.generateAudio ?? false);
const [watermark, setWatermark] = useState(cachedConfig.watermark ?? false);
const [seed, setSeed] = useState<number | null>(
  typeof cachedConfig.seed === "number" ? cachedConfig.seed : null
);
const [callbackUrl, setCallbackUrl] = useState(cachedConfig.callbackUrl || "");
const [clips, setClips] = useState<ClipItem[]>([]);
const [clipsHydrated, setClipsHydrated] = useState(false);
const [selectedClipIds, setSelectedClipIds] = useState<React.Key[]>([]);
const [pageReady, setPageReady] = useState(false);
const [submitting, setSubmitting] = useState(false);
const [pollingTaskIds, setPollingTaskIds] = useState<Set<string>>(new Set());
const [uploadingClip, setUploadingClip] = useState(false);
const [uploadingReference, setUploadingReference] = useState(false);
const [composing, setComposing] = useState(false);
const [composeModalOpen, setComposeModalOpen] = useState(false);
const [groupAssignOpen, setGroupAssignOpen] = useState(false);
const [groupAssignName, setGroupAssignName] = useState("");
const [assigningGroup, setAssigningGroup] = useState(false);
const [listTab, setListTab] = useState<"clips" | "films">("clips");
const [composedFilms, setComposedFilms] = useState<AiVideoComposedFilm[]>([]);
const [filmsHydrated, setFilmsHydrated] = useState(false);
const [previewFilm, setPreviewFilm] = useState<AiVideoComposedFilm | null>(null);
const [previewClip, setPreviewClip] = useState<ClipItem | null>(null);
const [dragActive, setDragActive] = useState(false);
const [draggingReferenceId, setDraggingReferenceId] = useState<string | null>(null);
const [dragOverReferenceId, setDragOverReferenceId] = useState<string | null>(null);
const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
const [promptAtIndex, setPromptAtIndex] = useState<number | null>(null);
const [resourcePickerActiveIndex, setResourcePickerActiveIndex] = useState(0);
const promptTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
const dragCounterRef = useRef(0);
const clipsRef = useRef<ClipItem[]>([]);
const hasRestoredPollingRef = useRef(false);

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
  if (!resourcePickerOpen) return;
  document
    .getElementById(`resource-picker-item-${resourcePickerActiveIndex}`)
    ?.scrollIntoView({ block: "nearest" });
}, [resourcePickerActiveIndex, resourcePickerOpen]);

useEffect(() => {
  if (!resourcePickerOpen) return;
  setResourcePickerActiveIndex((prev) =>
    referenceResources.length ? Math.min(prev, referenceResources.length - 1) : 0
  );
}, [referenceResources.length, resourcePickerOpen]);

useEffect(() => {
  clipsRef.current = clips;
}, [clips]);

useEffect(() => {
  if (!pageReady || clipsHydrated) return;
  let cancelled = false;
  void (async () => {
    try {
      let items = await fetchClipsFromServer();
      if (!items.length) {
        const legacy = readLegacyCachedClips();
        if (legacy.length) {
          const migrateRes = await fetch("/api/ai-video/clips", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clips: legacy.map((clip) => ({
                ...clip,
                updatedAt: clip.updatedAt || clip.createdAt || new Date().toISOString(),
              })),
            }),
          });
          const migrateData = (await migrateRes.json()) as { items?: ClipItem[]; error?: string };
          if (migrateRes.ok) {
            items = migrateData.items || [];
            try {
              window.localStorage.removeItem("ai-video:seedance-clips");
            } catch {}
          }
        }
      }
      if (!cancelled) setClips(items);
    } catch (error: any) {
      if (!cancelled) message.error(error.message || "加载片段列表失败");
    } finally {
      if (!cancelled) setClipsHydrated(true);
    }
  })();
  return () => {
    cancelled = true;
  };
}, [clipsHydrated, message, pageReady]);

useEffect(() => {
  if (!pageReady || filmsHydrated) return;
  let cancelled = false;
  void (async () => {
    try {
      const items = await fetchFilmsFromServer();
      if (!cancelled) setComposedFilms(items);
    } catch (error: unknown) {
      if (!cancelled) {
        message.error(error instanceof Error ? error.message : "加载成片列表失败");
      }
    } finally {
      if (!cancelled) setFilmsHydrated(true);
    }
  })();
  return () => {
    cancelled = true;
  };
}, [filmsHydrated, message, pageReady]);

useEffect(() => {
  try {
    window.localStorage.setItem(REFERENCE_CACHE_KEY, JSON.stringify(referenceResources));
  } catch {}
}, [referenceResources]);

useEffect(() => {
  writeStoredConfig({
    model,
    mode,
    prompt,
    firstFrameUrl,
    lastFrameUrl,
    firstFrameFiles: serializeUploadFiles(firstFrameFiles),
    lastFrameFiles: serializeUploadFiles(lastFrameFiles),
    ratio,
    resolution,
    duration,
    generateAudio,
    watermark,
    seed,
    callbackUrl,
  });
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

const durationConfig = useMemo(() => getSeedanceDurationConfig(model), [model]);

useEffect(() => {
  setDuration((prev) => normalizeSeedanceDuration(model, prev));
}, [model]);

const modelOptions = useMemo(
  () =>
    models.map((item) => ({
      label: `${item.label} · ${item.note}`,
      value: item.value,
    })),
  [models]
);

const selectedClips = useMemo(() => {
  const clipMap = new Map(clips.map((clip) => [clip.id, clip]));
  return selectedClipIds
    .map((id) => clipMap.get(String(id)))
    .filter((clip): clip is ClipItem => Boolean(clip?.videoUrl));
}, [clips, selectedClipIds]);

const composeOrderMap = useMemo(() => {
  const orderMap = new Map<string, number>();
  selectedClips.forEach((clip, index) => {
    orderMap.set(clip.id, index + 1);
  });
  return orderMap;
}, [selectedClips]);

const handleClipSelectionChange = useCallback((keys: React.Key[]) => {
  setSelectedClipIds((prev) => {
    const keySet = new Set(keys.map(String));
    const kept = prev.filter((id) => keySet.has(String(id)));
    const keptSet = new Set(kept.map(String));
    const added = keys.filter((id) => !keptSet.has(String(id)));
    return [...kept, ...added];
  });
}, []);


const selectedDuration = selectedClips.reduce((sum, item) => sum + (item.duration || 0), 0);

const existingComposeGroups = useMemo(() => {
  const names = new Set<string>();
  for (const clip of clips) {
    const name = String(clip.composeGroup || "").trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}, [clips]);

const composeGroupOptions = useMemo(
  () => existingComposeGroups.map((name) => ({ value: name, label: name })),
  [existingComposeGroups]
);

const updateClip = useCallback((id: string, patch: Partial<ClipItem>) => {
  setClips((prev) => prev.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)));
}, []);

const pollTask = useCallback(
  async (clipId: string, taskId: string) => {
    try {
      const res = await fetch(`/api/ai-video/seedance/${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "查询任务失败");

      if (data.clip) {
        updateClip(clipId, data.clip);
      } else {
        const task = data.task || {};
        updateClip(clipId, {
          status: task.status || "unknown",
          videoUrl: task.videoUrl || undefined,
          coverUrl: task.coverUrl || undefined,
        });
      }

      const status = String(data.clip?.status || data.task?.status || "");
      if (isFinished(status)) {
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
  if (!pageReady || !hasServerApiKey || !clipsHydrated || hasRestoredPollingRef.current) return;
  hasRestoredPollingRef.current = true;

  const pendingClips = clipsRef.current.filter(
    (clip) => clip.taskId && !isFinished(clip.status)
  );
  if (!pendingClips.length) return;

  setPollingTaskIds((prev) => {
    const next = new Set(prev);
    pendingClips.forEach((clip) => {
      if (clip.taskId) next.add(clip.taskId);
    });
    return next;
  });

  pendingClips.forEach((clip) => {
    if (clip.taskId) void pollTask(clip.id, clip.taskId);
  });
}, [clipsHydrated, hasServerApiKey, pageReady, pollTask]);

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


const restoreFormFromClip = useCallback(
  (record: ClipItem) => {
    const snapshot = resolveClipRestoreSnapshot(record);
    if (!snapshot) {
      message.warning("手动上传的片段无法回填配置");
      return;
    }

    setModel(snapshot.model);
    setMode(snapshot.mode);
    setPrompt(snapshot.prompt);
    setFirstFrameUrl(snapshot.firstFrameUrl);
    setLastFrameUrl(snapshot.lastFrameUrl);
    setFirstFrameFiles(ensureUploadFilesFromUrl(snapshot.firstFrameUrl, snapshot.firstFrameFiles, "首帧图片"));
    setLastFrameFiles(ensureUploadFilesFromUrl(snapshot.lastFrameUrl, snapshot.lastFrameFiles, "尾帧图片"));
    setReferenceResources(snapshot.referenceResources.map((item) => ({ ...item })));
    setRatio(snapshot.ratio);
    setResolution(snapshot.resolution);
    setDuration(normalizeSeedanceDuration(snapshot.model, snapshot.duration));
    setGenerateAudio(snapshot.generateAudio);
    setWatermark(snapshot.watermark);
    setSeed(snapshot.seed);
    setCallbackUrl(snapshot.callbackUrl);

    writeStoredConfig({
      model: snapshot.model,
      mode: snapshot.mode,
      prompt: snapshot.prompt,
      firstFrameUrl: snapshot.firstFrameUrl,
      lastFrameUrl: snapshot.lastFrameUrl,
      firstFrameFiles: serializeUploadFiles(readCachedUploadFiles(snapshot.firstFrameFiles)),
      lastFrameFiles: serializeUploadFiles(readCachedUploadFiles(snapshot.lastFrameFiles)),
      ratio: snapshot.ratio,
      resolution: snapshot.resolution,
      duration: snapshot.duration,
      generateAudio: snapshot.generateAudio,
      watermark: snapshot.watermark,
      seed: snapshot.seed,
      callbackUrl: snapshot.callbackUrl,
    });
    try {
      window.localStorage.setItem(REFERENCE_CACHE_KEY, JSON.stringify(snapshot.referenceResources));
    } catch {}

    message.success("已回填生成配置，可修改后重新提交");
    window.scrollTo({ top: 0, behavior: "smooth" });
  },
  [message]
);

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
    const snapshotFirstFrameUrl =
      mode === "first-frame" ? firstFrameReference?.url || firstFrameUrl : firstFrameUrl;
    const snapshotFirstFrameFiles =
      mode === "first-frame" && firstFrameReference && !firstFrameFiles.length
        ? ensureUploadFilesFromUrl(snapshotFirstFrameUrl, firstFrameFiles, "首帧图片")
        : firstFrameFiles;
    const formSnapshot = buildClipFormSnapshot({
      model,
      mode,
      prompt,
      firstFrameUrl: snapshotFirstFrameUrl,
      lastFrameUrl,
      firstFrameFiles: snapshotFirstFrameFiles,
      lastFrameFiles,
      referenceResources,
      ratio,
      resolution,
      duration,
      generateAudio,
      watermark,
      seed,
      callbackUrl,
    });
    const now = new Date().toISOString();
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
      createdAt: now,
      updatedAt: now,
      formSnapshot,
    };

    const savedClip = await saveClipToServer(clip);
    setClips((prev) => [savedClip, ...prev]);
    if (taskId && !isFinished(clip.status)) {
      setPollingTaskIds((prev) => new Set(prev).add(taskId));
    }
    setPrompt("");
    setFirstFrameUrl("");
    setLastFrameUrl("");
    setFirstFrameFiles([]);
    setLastFrameFiles([]);
    setReferenceResources([]);
    writeStoredConfig({
      prompt: "",
      firstFrameUrl: "",
      lastFrameUrl: "",
      firstFrameFiles: [],
      lastFrameFiles: [],
    });
    try {
      window.localStorage.removeItem(REFERENCE_CACHE_KEY);
    } catch {}
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
      const now = new Date().toISOString();
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
        createdAt: now,
        updatedAt: now,
      };
      const savedClip = await saveClipToServer(clip);
      setClips((prev) => [savedClip, ...prev]);
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
    const validated = validateReferenceFile(file);
    if (!validated.ok) {
      message.error(validated.error);
      throw new Error(validated.error);
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
          kind: (data.kind || validated.kind) as ReferenceKind,
          url: uploadedUrl,
          size: data.size || file.size,
        },
      ]);
      message.success("参考资源已上传");
    } catch (e: any) {
      message.error(e.message || "上传参考资源失败");
      throw e;
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
  customRequest: async ({ file, onSuccess, onError }) => {
    try {
      await uploadReferenceResource(file as File);
      onSuccess?.({});
    } catch (e: any) {
      onError?.(e);
    }
  },
  beforeUpload(file) {
    const validated = validateReferenceFile(file);
    if (!validated.ok) {
      message.error(validated.error);
      return Upload.LIST_IGNORE;
    }
    return true;
  },
};



function insertReferenceToken(resource: ReferenceResource) {
  const token = `@${getReferenceLabel(referenceResources, resource)}`;
  setPrompt((prev) => {
    const base = prev.trimEnd();
    return base ? `${base} ${token}` : token;
  });
  message.success(`已插入 ${token}`);
}

function insertReferenceTokenAtPrompt(resource: ReferenceResource) {
  const token = `@${getReferenceLabel(referenceResources, resource)}`;
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
  setResourcePickerActiveIndex(0);

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
    setResourcePickerActiveIndex(0);
    return;
  }

  if (resourcePickerOpen && promptAtIndex != null) {
    const activeToken = nextValue.slice(promptAtIndex, cursor);
    if (!activeToken.startsWith("@") || /\s/.test(activeToken.slice(1))) {
      setResourcePickerOpen(false);
      setPromptAtIndex(null);
      setResourcePickerActiveIndex(0);
    }
  }
}

function handlePromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (!resourcePickerOpen || !referenceResources.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    setResourcePickerActiveIndex((prev) => (prev + 1) % referenceResources.length);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    setResourcePickerActiveIndex(
      (prev) => (prev - 1 + referenceResources.length) % referenceResources.length
    );
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const resource = referenceResources[resourcePickerActiveIndex];
    if (resource) insertReferenceTokenAtPrompt(resource);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    setResourcePickerOpen(false);
    setPromptAtIndex(null);
    setResourcePickerActiveIndex(0);
  }
}

function reorderReferenceResources(activeId: string, overId: string) {
  setReferenceResources((prev) => {
    const from = prev.findIndex((item) => item.id === activeId);
    const to = prev.findIndex((item) => item.id === overId);
    if (from < 0 || to < 0 || from === to) return prev;
    const next = [...prev];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });
}

function handleReferenceReorderDragStart(event: React.DragEvent, id: string) {
  setDraggingReferenceId(id);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", id);
}

function handleReferenceReorderDragOver(event: React.DragEvent, id: string) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  if (draggingReferenceId && id !== draggingReferenceId) {
    setDragOverReferenceId(id);
  }
}

function handleReferenceReorderDragLeave(event: React.DragEvent, id: string) {
  const related = event.relatedTarget as Node | null;
  if (related && event.currentTarget.contains(related)) return;
  setDragOverReferenceId((prev) => (prev === id ? null : prev));
}

function handleReferenceReorderDrop(event: React.DragEvent, targetId: string) {
  event.preventDefault();
  const activeId = draggingReferenceId || event.dataTransfer.getData("text/plain");
  if (activeId && targetId && activeId !== targetId) {
    reorderReferenceResources(activeId, targetId);
  }
  setDraggingReferenceId(null);
  setDragOverReferenceId(null);
}

function handleReferenceReorderDragEnd() {
  setDraggingReferenceId(null);
  setDragOverReferenceId(null);
}

function removeReferenceResource(id: string) {
  setReferenceResources((prev) => prev.filter((item) => item.id !== id));
  message.success("已移除参考资源");
}


const batchAssignComposeGroup = useCallback(
  async (clipIds: string[], composeGroup: string) => {
    const nextGroup = composeGroup.trim();
    if (!nextGroup) {
      message.warning("请输入分组名称");
      return false;
    }
    if (!clipIds.length) {
      message.warning("请先勾选片段");
      return false;
    }

    const clipsToUpdate = clipsRef.current
      .filter((clip) => clipIds.includes(clip.id))
      .map((clip) => ({ ...clip, composeGroup: nextGroup }));

    if (!clipsToUpdate.length) return false;

    setAssigningGroup(true);
    for (const clip of clipsToUpdate) {
      updateClip(clip.id, { composeGroup: nextGroup });
    }
    try {
      const res = await fetch("/api/ai-video/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clips: clipsToUpdate }),
      });
      const data = (await res.json()) as { items?: ClipItem[]; error?: string };
      if (!res.ok || !Array.isArray(data.items)) {
        throw new Error(data.error || "批量设置分组失败");
      }
      for (const saved of data.items) {
        updateClip(saved.id, saved);
      }
      message.success(`已将 ${data.items.length} 个片段设为「${nextGroup}」`);
      setSelectedClipIds([]);
      return true;
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "批量设置分组失败");
      return false;
    } finally {
      setAssigningGroup(false);
    }
  },
  [message, updateClip]
);

const openGroupAssignModal = useCallback(() => {
  if (!selectedClips.length) {
    message.warning("请先勾选要分组的片段");
    return;
  }
  setGroupAssignName("");
  setGroupAssignOpen(true);
}, [message, selectedClips.length]);

const clearSelectedComposeGroups = useCallback(async () => {
  if (!selectedClips.length) {
    message.warning("请先勾选片段");
    return;
  }
  setAssigningGroup(true);
  try {
    const clipsToUpdate = selectedClips.map((clip) => ({ ...clip, composeGroup: null }));
    for (const clip of clipsToUpdate) {
      updateClip(clip.id, { composeGroup: null });
    }
    const res = await fetch("/api/ai-video/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clips: clipsToUpdate }),
    });
    const data = (await res.json()) as { items?: ClipItem[]; error?: string };
    if (!res.ok || !Array.isArray(data.items)) {
      throw new Error(data.error || "清除分组失败");
    }
    for (const saved of data.items) {
      updateClip(saved.id, saved);
    }
    message.success(`已清除 ${data.items.length} 个片段的分组`);
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : "清除分组失败");
  } finally {
    setAssigningGroup(false);
  }
}, [message, selectedClips, updateClip]);

async function reloadComposedFilms() {
  try {
    const items = await fetchFilmsFromServer();
    setComposedFilms(items);
    setFilmsHydrated(true);
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : "刷新成片列表失败");
  }
}

async function handleComposeSubmit(payload: {
  mode: "sequential" | "random";
  segments?: Array<{ id: string; name: string; videoUrl: string }>;
  groups?: Array<{ name: string; segments: Array<{ id: string; name: string; videoUrl: string }> }>;
  outputCount?: number;
  orderRule?: string;
  addBackgroundMusic?: boolean;
}): Promise<ComposeFilmModalResult | null> {
  setComposing(true);
  try {
    const res = await fetch("/api/ai-video/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "合成视频失败");
    const urls = Array.isArray(data.films)
      ? data.films.map((film: { videoUrl?: string }) => film.videoUrl).filter(Boolean)
      : data.videoUrl
        ? [data.videoUrl]
        : [];
    await reloadComposedFilms();
    setListTab("films");
    const bgmName = Array.isArray(data.films)
      ? data.films.find((film: { backgroundMusic?: string | null }) => film.backgroundMusic)?.backgroundMusic
      : null;
    const bgmHint = bgmName ? `，背景音乐：${bgmName}` : "";
    message.success(
      payload.mode === "random"
        ? `已生成 ${data.generated || urls.length} 条成片${bgmHint}`
        : `成片已合成${bgmHint}`
    );
    return {
      mode: payload.mode,
      films: Array.isArray(data.films) ? data.films : [],
      generated: Number(data.generated) || urls.length,
      videoUrl: urls[0] || null,
    };
  } catch (e: unknown) {
    message.error(e instanceof Error ? e.message : "合成视频失败");
    return null;
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

const handleReferenceDrop = useCallback(
  (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = 0;
    setDragActive(false);

    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    void uploadReferenceResource(file);
  },
  [uploadReferenceResource]
);
  const clipById = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips]);

  const handlePreviewFilm = useCallback((film: AiVideoComposedFilm) => {
    setPreviewFilm(film);
  }, []);

  const handlePreviewClip = useCallback((clip: ClipItem) => {
    setPreviewClip(clip);
  }, []);

  const handleDeleteFilm = useCallback(
    async (record: AiVideoComposedFilm) => {
      await deleteFilmFromServer(record.id);
      setComposedFilms((prev) => prev.filter((item) => item.id !== record.id));
      message.success("已删除成片记录");
    },
    [message]
  );

  const handleDeleteClip = useCallback(
    (record: ClipItem) => {
      void (async () => {
        try {
          await deleteClipFromServer(record.id);
          setClips((prev) => prev.filter((clip) => clip.id !== record.id));
          setSelectedClipIds((prev) => prev.filter((id) => id !== record.id));
          message.success("已移除片段");
        } catch (error: unknown) {
          message.error(error instanceof Error ? error.message : "删除片段失败");
        }
      })();
    },
    [message]
  );

  const filmColumns = useMemo(
    () =>
      buildFilmTableColumns({
        clipById,
        onPreviewFilm: handlePreviewFilm,
        onPreviewClip: handlePreviewClip,
        onDeleteFilm: handleDeleteFilm,
      }),
    [clipById, handleDeleteFilm, handlePreviewClip, handlePreviewFilm]
  );

  const clipColumns = useMemo(
    () =>
      buildClipTableColumns({
        composeOrderMap,
        onCopyPrompt: copyPrompt,
        onPreviewClip: handlePreviewClip,
        onPollTask: pollTask,
        onDownloadClip: downloadClip,
        onRestoreFormFromClip: restoreFormFromClip,
        onDeleteClip: handleDeleteClip,
      }),
    [composeOrderMap, copyPrompt, downloadClip, handleDeleteClip, handlePreviewClip, pollTask, restoreFormFromClip]
  );

  const handleGroupAssignConfirm = useCallback(async () => {
    const ok = await batchAssignComposeGroup(
      selectedClips.map((clip) => clip.id),
      groupAssignName
    );
    if (ok) setGroupAssignOpen(false);
  }, [batchAssignComposeGroup, groupAssignName, selectedClips]);

  const handlePromptBlur = useCallback(() => {
    window.setTimeout(() => {
      setResourcePickerOpen(false);
      setResourcePickerActiveIndex(0);
    }, 160);
  }, []);

  return {
    pageReady,
    message,
    models,
    hasServerApiKey,
    showCallbackUrl,
    model,
    setModel,
    mode,
    setMode,
    prompt,
    firstFrameUrl,
    lastFrameUrl,
    firstFrameFiles,
    lastFrameFiles,
    setFirstFrameFiles,
    setFirstFrameUrl,
    setLastFrameFiles,
    setLastFrameUrl,
    referenceResources,
    ratio,
    setRatio,
    resolution,
    setResolution,
    duration,
    setDuration,
    generateAudio,
    setGenerateAudio,
    watermark,
    setWatermark,
    seed,
    setSeed,
    callbackUrl,
    setCallbackUrl,
    clips,
    clipsHydrated,
    selectedClipIds,
    submitting,
    uploadingClip,
    uploadingReference,
    composing,
    composeModalOpen,
    setComposeModalOpen,
    groupAssignOpen,
    setGroupAssignOpen,
    groupAssignName,
    setGroupAssignName,
    assigningGroup,
    listTab,
    setListTab,
    composedFilms,
    filmsHydrated,
    previewFilm,
    setPreviewFilm,
    previewClip,
    setPreviewClip,
    dragActive,
    draggingReferenceId,
    dragOverReferenceId,
    resourcePickerOpen,
    resourcePickerActiveIndex,
    setResourcePickerActiveIndex,
    setResourcePickerOpen,
    promptTextAreaRef,
    selectedModel,
    durationConfig,
    modelOptions,
    selectedClips,
    selectedDuration,
    composeGroupOptions,
    clipUploadProps,
    referenceUploadProps,
    clipColumns,
    filmColumns,
    handleClipSelectionChange,
    openGroupAssignModal,
    clearSelectedComposeGroups,
    handleGroupAssignConfirm,
    handleComposeSubmit,
    submitTask,
    handlePromptChange,
    handlePromptKeyDown,
    handlePromptBlur,
    insertReferenceToken,
    insertReferenceTokenAtPrompt,
    handleReferenceReorderDragStart,
    handleReferenceReorderDragOver,
    handleReferenceReorderDragLeave,
    handleReferenceReorderDrop,
    handleReferenceReorderDragEnd,
    removeReferenceResource,
    buildFrameUploadProps,
    clearFrameUpload,
    handleFrameDragEnter,
    handleFrameDragLeave,
    handleFrameDragOver,
    handleFrameDrop,
    handleReferenceDrop,
  };
}
