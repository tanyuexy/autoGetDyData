import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import dayjs from "dayjs";
import { buildPublishTaskColumns } from "@/components/creator-publish/publishTaskColumns";
import { useTaskContext } from "@/contexts/TaskContext";
import { isTerminableTask } from "@/lib/creator-publish/constants";
import {
  buildScheduleTimeOptionsForDay,
  DEFAULT_PUBLISH_TASK_TABLE_SORTER,
  scheduleQuickPresets,
  type PublishTaskTableSorter,
} from "@/lib/creator-publish/scheduleUtils";
import type {
  EditTaskState,
  PublishTask,
  TaskPayload,
  TaskStatus,
  TaskType,
} from "@/lib/creator-publish/types";
import { normalizeFeishuAiProvider } from "@/lib/feishu/aiProvider";
import type { ConfigData, FeishuAiProvider } from "@/types";
import { copyToClipboard } from "@/lib/copyToClipboard";

async function uploadOne(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch("/api/creator/publish/upload", {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "upload failed");
    return data.fileKey as string;
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("上传超时，请检查网络后重试");
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function useCreatorPublishPage() {
  const { message } = App.useApp();
  const { isNamespaceBusy, selectTaskLog, runningTasks, startTask, activeTasks } = useTaskContext();
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [feishuAiProvider, setFeishuAiProvider] = useState<FeishuAiProvider>("minimax");
  const [generatingFeishuAi, setGeneratingFeishuAi] = useState(false);

  const [type, setType] = useState<TaskType>("video");
  const [accountNames, setAccountNames] = useState<string[]>([]);

  const [videoFileKey, setVideoFileKey] = useState<string>("");
  const [imageKeys, setImageKeys] = useState<string[]>([]);
  const [coverImageKey, setCoverImageKey] = useState<string | undefined>(undefined);

  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [productLink, setProductLink] = useState<string>("");
  const [productTitle, setProductTitle] = useState<string>("");
  const [approvalNumber, setApprovalNumber] = useState<string>("不包含广审内容");
  const [isAiContent, setIsAiContent] = useState<boolean>(false);
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<{ name: string }[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [editingTask, setEditingTask] = useState<PublishTask | null>(null);
  const [materialPreviewTask, setMaterialPreviewTask] = useState<PublishTask | null>(null);
  const [editState, setEditState] = useState<EditTaskState>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [tableSorter, setTableSorter] = useState<PublishTaskTableSorter | null>(
    DEFAULT_PUBLISH_TASK_TABLE_SORTER
  );
  const [taskStatusFilters, setTaskStatusFilters] = useState<TaskStatus[]>([]);
  const [taskShopFilters, setTaskShopFilters] = useState<string[]>([]);
  const [taskTypeFilters, setTaskTypeFilters] = useState<TaskType[]>([]);

  const schedulePresets = useMemo(() => scheduleQuickPresets(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config");
        if (!res.ok) return;
        const cfg = (await res.json()) as ConfigData;
        if (cancelled) return;
        setFeishuAiProvider(normalizeFeishuAiProvider(cfg.creatorPublish?.feishuAiProvider));
      } catch {
        /* 保持默认 minimax */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const editScheduleTimeOptions = useMemo(() => {
    if (!editState?.scheduleAt) return [];
    const d = dayjs(editState.scheduleAt);
    if (!d.isValid()) return [];
    return buildScheduleTimeOptionsForDay(d);
  }, [editState?.scheduleAt]);

  const taskShopSelectOptions = useMemo(() => {
    const names = [...new Set(tasks.map((t) => t.accountName).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "zh-CN")
    );
    return names.map((n) => ({ label: n, value: n }));
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let list = tasks;
    if (taskTypeFilters.length > 0) {
      const set = new Set(taskTypeFilters);
      list = list.filter((t) => set.has(t.payload.type));
    }
    if (taskStatusFilters.length > 0) {
      const set = new Set(taskStatusFilters);
      list = list.filter((t) => set.has(t.status));
    }
    if (taskShopFilters.length > 0) {
      const set = new Set(taskShopFilters);
      list = list.filter((t) => set.has(t.accountName));
    }
    return list;
  }, [taskTypeFilters, taskShopFilters, taskStatusFilters, tasks]);

  useEffect(() => {
    const names = new Set(tasks.map((t) => t.accountName));
    setTaskShopFilters((prev) => {
      const next = prev.filter((n) => names.has(n));
      return next.length === prev.length ? prev : next;
    });
  }, [tasks]);

  const terminableSelectedRowKeys = useMemo(() => {
    const selected = new Set(selectedRowKeys);
    return tasks.filter((task) => selected.has(task.id) && isTerminableTask(task)).map((task) => task.id);
  }, [selectedRowKeys, tasks]);

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ label: a.name, value: a.name })),
    [accounts]
  );

  const editAccountSelectOptions = useMemo(() => {
    const opts = accounts.map((a) => ({ label: a.name, value: a.name }));
    const cur = editState?.accountName?.trim();
    if (cur && !opts.some((o) => o.value === cur)) {
      return [{ label: `${cur}（当前）`, value: cur }, ...opts];
    }
    return opts;
  }, [accounts, editState?.accountName]);

  const rowSelection = useMemo(
    () => ({ selectedRowKeys, onChange: setSelectedRowKeys }),
    [selectedRowKeys]
  );

  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch("/api/creator/list");
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch {
      message.error("获取账号列表失败");
    }
    setLoadingAccounts(false);
  }, [message]);

  const fetchTasks = useCallback(async () => {
    setLoadingTasks(true);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch("/api/creator/publish/tasks");
        const data = await res.json();
        setTasks(data.tasks || []);
        setSelectedRowKeys((prev) => {
          const ids = new Set((data.tasks || []).map((t: PublishTask) => t.id));
          return prev.filter((k) => ids.has(k));
        });
        setLoadingTasks(false);
        return;
      } catch (e: unknown) {
        lastErr = e;
        if (!(e instanceof TypeError) || attempt === 2) break;
        await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
      }
    }
    message.error("获取任务列表失败");
    setLoadingTasks(false);
  }, [message]);

  useEffect(() => {
    fetchAccounts();
    fetchTasks();
    const t = setInterval(fetchTasks, 60_000);
    return () => clearInterval(t);
  }, [fetchAccounts, fetchTasks]);

  const donePublishTaskIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let shouldRefresh = false;
    for (const [id, st] of activeTasks) {
      if (st.namespace === "creator-publish" && st.done) {
        if (!donePublishTaskIdsRef.current.has(id)) {
          donePublishTaskIdsRef.current.add(id);
          shouldRefresh = true;
        }
      }
    }
    if (shouldRefresh) void fetchTasks();
  }, [activeTasks, fetchTasks]);

  const prevRunningPublishIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(
      runningTasks.filter((t) => t.namespace === "creator-publish").map((t) => t.taskId)
    );
    const prev = prevRunningPublishIdsRef.current;
    let terminated = false;
    for (const id of prev) {
      if (!current.has(id)) {
        terminated = true;
        break;
      }
    }
    prevRunningPublishIdsRef.current = current;
    if (terminated) void fetchTasks();
  }, [runningTasks, fetchTasks]);

  const videoUploadProps = useMemo(
    () => ({
      maxCount: 1,
      beforeUpload: async (file: File) => {
        try {
          const key = await uploadOne(file);
          setVideoFileKey(key);
          message.success(`上传成功: ${key}`);
        } catch (e: unknown) {
          message.error(e instanceof Error ? e.message : "上传失败");
        }
        return false;
      },
    }),
    [message]
  );

  const imageUploadProps = useMemo(
    () => ({
      multiple: true,
      beforeUpload: async (file: File) => {
        try {
          const key = await uploadOne(file);
          setImageKeys((prev) => [...prev, key]);
          message.success(`上传成功: ${key}`);
        } catch (e: unknown) {
          message.error(e instanceof Error ? e.message : "上传失败");
        }
        return false;
      },
    }),
    [message]
  );

  const coverOptions = useMemo(
    () => imageKeys.map((k) => ({ label: k, value: k })),
    [imageKeys]
  );

  async function handleCreateTasks() {
    if (!accountNames.length) {
      message.error("请选择账号");
      return;
    }

    if (type === "video" && !videoFileKey) {
      message.error("请先上传视频文件");
      return;
    }
    if (type === "article" && imageKeys.length === 0) {
      message.error("请先上传图文图片");
      return;
    }
    if (!title.trim()) {
      message.error("请填写标题");
      return;
    }
    if (!description.trim()) {
      message.error("请填写描述");
      return;
    }
    if (!productTitle.trim()) {
      message.error("请填写商品标题");
      return;
    }
    if (!approvalNumber.trim()) {
      message.error("请填写广审批文号");
      return;
    }
    if (!productLink.trim()) {
      message.error("请填写商品链接");
      return;
    }

    setCreating(true);
    try {
      const payloadBase = {
        type,
        title: title.trim(),
        description: description.trim(),
        productTitle: productTitle.trim(),
        approvalNumber: approvalNumber.trim(),
        isAiContent,
        productLink: productLink.trim() || undefined,
        scheduleAt,
      };

      const payload: TaskPayload =
        type === "video"
          ? { ...payloadBase, type: "video", videoFileKey }
          : {
              ...payloadBase,
              type: "article",
              imagesFileKeys: imageKeys,
              coverImageKey: coverImageKey || undefined,
            };

      let createdCount = 0;
      for (const accountName of accountNames) {
        try {
          const res = await fetch("/api/creator/publish/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountName, payload }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "创建任务失败");
          createdCount++;
        } catch (e: unknown) {
          if (createdCount > 0) {
            message.success(`已创建 ${createdCount}/${accountNames.length} 个任务`);
          }
          throw new Error(
            `为「${accountName}」创建任务失败` +
              (createdCount > 0 ? `（已完成 ${createdCount}/${accountNames.length}）` : "") +
              `: ${e instanceof Error ? e.message : "未知错误"}`
          );
        }
      }

      message.success(`已创建 ${createdCount} 个任务`);
      setAccountNames([]);
      setTitle("");
      setDescription("");
      setProductLink("");
      setProductTitle("");
      setApprovalNumber("不包含广审内容");
      setIsAiContent(false);
      setScheduleAt(null);
      await fetchTasks();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "创建任务失败");
    }
    setCreating(false);
  }

  async function handleRetryTask(task: PublishTask) {
    if (task.status !== "failed" && task.status !== "cancelled" && task.status !== "success") {
      message.warning("仅失败/已取消/成功的任务可重试");
      return;
    }
    try {
      const res = await fetch("/api/creator/publish/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", id: task.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重试失败");
      message.success("已重新加入队列");
      await fetchTasks();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "重试失败");
    }
  }

  async function handleRunNow(task: PublishTask) {
    try {
      const res = await fetch("/api/creator/publish/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run-now", id: task.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "立即执行失败");
      message.success("已设为立即执行");
      await fetchTasks();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "立即执行失败");
    }
  }

  async function handleDeleteTask(task: PublishTask) {
    try {
      const res = await fetch("/api/creator/publish/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: task.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");

      message.success("已删除");
      await fetchTasks();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function handleStartTasks() {
    if (!selectedRowKeys.length) return;
    try {
      const res = await fetch("/api/creator/publish/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start-bulk", ids: selectedRowKeys }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "启动失败");
      setSelectedRowKeys([]);
      message.success(`已启动 ${data.started} 个任务`);
      await fetchTasks();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "启动任务失败");
    }
  }

  async function handleBatchDelete() {
    if (!selectedRowKeys.length) return;
    let deleted = 0;
    let failed = 0;
    for (const id of selectedRowKeys) {
      try {
        const res = await fetch("/api/creator/publish/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id }),
        });
        const data = await res.json();
        if (!res.ok) {
          failed++;
          continue;
        }
        deleted++;
      } catch {
        failed++;
      }
    }
    setSelectedRowKeys([]);
    message.success(`已删除 ${deleted} 个任务${failed > 0 ? `，${failed} 个失败` : ""}`);
    await fetchTasks();
  }

  async function handleKillSelected() {
    if (!terminableSelectedRowKeys.length) {
      message.warning("仅队列中/执行中的任务可终止");
      return;
    }
    try {
      const res = await fetch("/api/creator/publish/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill-bulk", ids: terminableSelectedRowKeys }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "终止失败");
      setSelectedRowKeys([]);
      message.success(`已终止 ${data.killed} 个任务`);
      await fetchTasks();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "终止失败");
    }
  }

  async function handleImportFromFeishu() {
    setImporting(true);
    try {
      const taskId = await startTask("/api/creator/publish/import-from-feishu", {}, "creator-publish");
      message.info(`导入任务已启动: ${taskId}`);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "启动导入失败");
    }
    setImporting(false);
  }

  async function handleFeishuAiProviderChange(value: FeishuAiProvider) {
    setFeishuAiProvider(value);
    try {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("读取配置失败");
      const cfg = (await res.json()) as ConfigData;
      const saveRes = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cfg,
          creatorPublish: {
            ...(cfg.creatorPublish || {}),
            feishuAiProvider: normalizeFeishuAiProvider(value),
          },
        }),
      });
      if (!saveRes.ok) {
        const data = await saveRes.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "保存配置失败");
      }
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "保存 AI 模型配置失败");
    }
  }

  async function handleGenerateFeishuAiContent() {
    setGeneratingFeishuAi(true);
    try {
      const taskId = await startTask(
        "/api/creator/publish/generate-feishu-ai-content",
        { provider: feishuAiProvider },
        "creator-publish"
      );
      message.info(`AI正文生成任务已启动: ${taskId}`);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "启动AI正文生成失败");
    }
    setGeneratingFeishuAi(false);
  }

  async function handleRefreshTasks() {
    try {
      await fetchTasks();
      message.success("任务列表已刷新");
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "刷新失败");
    }
  }

  function openEditTask(task: PublishTask) {
    setEditingTask(task);
    setEditState({
      id: task.id,
      accountName: String(task.accountName || "").trim(),
      title: String(task.payload.title || ""),
      description: String(task.payload.description || ""),
      productLink: String(task.payload.productLink || ""),
      productTitle: String(task.payload.productTitle || ""),
      approvalNumber: String(task.payload.approvalNumber || "不包含广审内容"),
      isAiContent: task.payload.isAiContent === true,
      scheduleAt: task.payload.scheduleAt || null,
    });
  }

  function closeEditTask() {
    setEditingTask(null);
    setEditState(null);
    setSavingEdit(false);
  }

  function materialPreviewUrl(fileKey: string) {
    return `/api/creator/publish/material?key=${encodeURIComponent(fileKey)}`;
  }

  function taskHasMaterial(task: PublishTask) {
    if (task.payload.type === "video") {
      return Boolean(task.payload.videoFileKey);
    }
    return Array.isArray(task.payload.imagesFileKeys) && task.payload.imagesFileKeys.length > 0;
  }

  function openMaterialPreview(task: PublishTask) {
    if (!taskHasMaterial(task)) {
      message.warning("暂无素材可预览");
      return;
    }
    setMaterialPreviewTask(task);
  }

  function closeMaterialPreview() {
    setMaterialPreviewTask(null);
  }

  async function handleSaveEditTask() {
    if (!editingTask || !editState) return;
    const nextAccount = editState.accountName.trim();
    if (!nextAccount) {
      message.warning("请选择店铺/账号");
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch("/api/creator/publish/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: editingTask.id,
          accountName: nextAccount,
          payload: {
            title: editState.title.trim(),
            description: editState.description.trim(),
            productLink: editState.productLink.trim() || undefined,
            productTitle: editState.productTitle.trim() || undefined,
            approvalNumber: editState.approvalNumber.trim() || undefined,
            isAiContent: editState.isAiContent,
            scheduleAt: editState.scheduleAt,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      message.success("任务已更新");
      closeEditTask();
      await fetchTasks();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
    setSavingEdit(false);
  }

  async function copyTaskId(id: string) {
    const ok = await copyToClipboard(id);
    if (ok) {
      message.success("已复制任务 ID");
    } else {
      message.error("复制失败，请手动选择复制");
    }
  }

  const columns = useMemo(
    () =>
      buildPublishTaskColumns({
        tableSorter,
        runningTasks,
        isNamespaceBusy,
        selectTaskLog,
        taskHasMaterial,
        openMaterialPreview,
        handleRetryTask,
        openEditTask,
        handleRunNow,
        handleDeleteTask,
        copyTaskId,
      }),
    [tableSorter, runningTasks, isNamespaceBusy, selectTaskLog, copyTaskId]
  );

  const runningCount = tasks.filter((t) => t.status === "running").length;

  return {
    type,
    setType,
    accountNames,
    setAccountNames,
    accountOptions,
    loadingAccounts,
    videoUploadProps,
    videoFileKey,
    imageUploadProps,
    imageKeys,
    coverImageKey,
    setCoverImageKey,
    coverOptions,
    productLink,
    setProductLink,
    title,
    setTitle,
    description,
    setDescription,
    productTitle,
    setProductTitle,
    approvalNumber,
    setApprovalNumber,
    isAiContent,
    setIsAiContent,
    scheduleAt,
    setScheduleAt,
    schedulePresets,
    creating,
    handleCreateTasks,
    taskTypeFilters,
    setTaskTypeFilters,
    taskStatusFilters,
    setTaskStatusFilters,
    taskShopFilters,
    setTaskShopFilters,
    taskShopSelectOptions,
    selectedRowKeys,
    terminableSelectedRowKeys,
    handleStartTasks,
    handleKillSelected,
    handleBatchDelete,
    feishuAiProvider,
    handleFeishuAiProviderChange,
    handleGenerateFeishuAiContent,
    generatingFeishuAi,
    isNamespaceBusy,
    handleImportFromFeishu,
    importing,
    handleRefreshTasks,
    loadingTasks,
    filteredTasks,
    columns,
    tableSorter,
    setTableSorter,
    rowSelection,
    runningCount,
    fetchTasks,
    editingTask,
    editState,
    setEditState,
    editAccountSelectOptions,
    editScheduleTimeOptions,
    savingEdit,
    closeEditTask,
    handleSaveEditTask,
    materialPreviewTask,
    closeMaterialPreview,
    materialPreviewUrl,
  };
}
