"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Badge,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Popover,
  Radio,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Upload,
  Typography,
} from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { useTaskContext } from "@/contexts/TaskContext";
import { antdTagPresetStyle } from "@/lib/semanticTagStyles";

const { Text } = Typography;

type TaskType = "video" | "article";

const TASK_TYPE_OPTIONS: { label: string; value: TaskType }[] = [
  { label: "视频", value: "video" },
  { label: "图文", value: "article" },
];

type TaskStatus = "pending" | "queued" | "running" | "success" | "failed" | "cancelled";

type FeishuAiProvider = "siliconflow" | "deepseek";

const TERMINABLE_TASK_STATUSES = new Set<TaskStatus>(["queued", "running"]);

/** 表格「操作」列：link 按钮默认 padding 较大，收一点横向间距 */
const TASK_TABLE_OP_LINK_STYLE = { paddingInline: 1 } as const;

const STATUS_MAP: Record<TaskStatus, { color: string; text: string }> = {
  pending: { color: "default", text: "待执行" },
  queued: { color: "blue", text: "队列中" },
  running: { color: "processing", text: "执行中" },
  success: { color: "success", text: "成功" },
  failed: { color: "error", text: "失败" },
  cancelled: { color: "warning", text: "已取消" },
};

const TASK_STATUS_ORDER: TaskStatus[] = [
  "pending",
  "queued",
  "running",
  "success",
  "failed",
  "cancelled",
];

const TASK_STATUS_SELECT_OPTIONS: { label: string; value: TaskStatus }[] =
  TASK_STATUS_ORDER.map((s) => ({ label: STATUS_MAP[s].text, value: s }));

const MULTILINE_TEXT_STYLE = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflow: "hidden",
  whiteSpace: "normal",
  wordBreak: "break-word",
  lineHeight: 1.5,
  textAlign: "left",
  color: "var(--vol-ink)",
} as const;

const ON_ROW_STYLE = { verticalAlign: "top" } as const;

function isTerminableTask(task: PublishTask) {
  return TERMINABLE_TASK_STATUSES.has(task.status);
}

/** 「立即」（无定时）排在升序最前；有 scheduleAt 的按时间戳排序 */
function getPublishTaskScheduleSortValue(task: PublishTask): number {
  const raw = task.payload.scheduleAt;
  if (raw == null || !String(raw).trim()) return Number.NEGATIVE_INFINITY;
  const ms = dayjs(raw).valueOf();
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

const SCHEDULE_SHOW_TIME = { format: "HH:mm" as const, minuteStep: 5 as const };

function scheduleDisabledDate(current: Dayjs | null) {
  if (!current) return false;
  return current.isBefore(dayjs().startOf("day"));
}

function scheduleDisabledTime(current: Dayjs | null) {
  if (!current || !current.isSame(dayjs(), "day")) return {};
  const now = dayjs();
  return {
    disabledHours: () => Array.from({ length: now.hour() }, (_, i) => i),
    disabledMinutes: (h: number) =>
      h === now.hour() ? Array.from({ length: now.minute() + 1 }, (_, i) => i) : [],
  };
}

/** 选「定时」时的默认时间：不早于当前时刻 */
function defaultFutureScheduleIso(): string {
  const t = dayjs().add(1, "hour").startOf("hour");
  return (t.isBefore(dayjs()) ? dayjs().add(2, "hour").startOf("hour") : t).toISOString();
}

function scheduleQuickPresets() {
  const n = dayjs();
  return [
    { label: "30 分钟后", value: n.add(30, "minute").second(0).millisecond(0) },
    { label: "1 小时后", value: n.add(1, "hour").startOf("hour") },
    { label: "2 小时后", value: n.add(2, "hour").startOf("hour") },
    { label: "明天 09:00", value: n.add(1, "day").hour(9).minute(0).second(0) },
    { label: "明天 12:00", value: n.add(1, "day").hour(12).minute(0).second(0) },
    { label: "后天 09:00", value: n.add(2, "day").hour(9).minute(0).second(0) },
  ];
}

/**
 * 编辑任务用：某一天内、不早于「现在」的 5 分钟档（下拉选，避免 rc-picker 时间列在选中后强制 syncScroll 导致滚动跳动）。
 */
function buildScheduleTimeOptionsForDay(dateTime: Dayjs) {
  const dayStart = dateTime.startOf("day");
  const now = dayjs();
  const opts: { label: string; value: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      const candidate = dayStart.hour(h).minute(m).second(0).millisecond(0);
      if (candidate.isBefore(now)) continue;
      const label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      opts.push({ label, value: label });
    }
  }
  return opts;
}

type TaskPayload =
  | {
      type: "video";
      videoFileKey: string;
      title?: string;
      description?: string;
      scheduleAt?: string | null;
      productTitle?: string;
      approvalNumber?: string;
      isAiContent?: boolean;
      productLink?: string;
      publishEnabled?: boolean;
      publishWaitSec?: number;
    }
  | {
      type: "article";
      imagesFileKeys: string[];
      title?: string;
      description?: string;
      scheduleAt?: string | null;
      coverImageKey?: string;
      productLink?: string;
      productTitle?: string;
      approvalNumber?: string;
      isAiContent?: boolean;
      publishEnabled?: boolean;
      publishWaitSec?: number;
    };

type PublishTask = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** 表格可见字段最后变更时间，见 lib/creatorPublishStore#patchTouchesTaskTable */
  displayUpdatedAt?: string;
  accountName: string;
  status: TaskStatus;
  payload: TaskPayload;
  lastError?: string;
  taskId?: string;
  feishuRowNumber?: number;
};

type EditTaskState = {
  id: string;
  /** 店铺/抖创账号，与 task.accountName 一致 */
  accountName: string;
  title: string;
  description: string;
  productLink: string;
  productTitle: string;
  approvalNumber: string;
  isAiContent: boolean;
  scheduleAt: string | null;
} | null;

export default function CreatorPublishPage() {
  const { message } = App.useApp();
  const { isNamespaceBusy, selectTaskLog, runningTasks, startTask, activeTasks } = useTaskContext();
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [feishuAiProvider, setFeishuAiProvider] = useState<FeishuAiProvider>("siliconflow");
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
  const [editState, setEditState] = useState<EditTaskState>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [scheduleColumnSortOrder, setScheduleColumnSortOrder] = useState<"ascend" | "descend" | null>(
    null
  );
  /** 任务列表筛选：空数组=不过滤。店铺值为 accountName（飞书「所属店铺」） */
  const [taskStatusFilters, setTaskStatusFilters] = useState<TaskStatus[]>([]);
  const [taskShopFilters, setTaskShopFilters] = useState<string[]>([]);
  const [taskTypeFilters, setTaskTypeFilters] = useState<TaskType[]>([]);

  const schedulePresets = useMemo(() => scheduleQuickPresets(), []);

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

  /** 编辑弹窗：配置内账号 + 当前任务账号（若不在配置中则顶部展示，避免无法保存） */
  const editAccountSelectOptions = useMemo(() => {
    const opts = accounts.map((a) => ({ label: a.name, value: a.name }));
    const cur = editState?.accountName?.trim();
    if (cur && !opts.some((o) => o.value === cur)) {
      return [{ label: `${cur}（当前）`, value: cur }, ...opts];
    }
    return opts;
  }, [accounts, editState?.accountName]);

  const handleRow = useCallback(() => ({ style: ON_ROW_STYLE }), []);

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
  }, []);

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
        // only retry network errors, not HTTP errors
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

  /** 本页触发的发布任务在终端侧标记完成（SSE / 快照）后立即刷新列表 */
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

  /** 任意 creator-publish 进程从服务端运行列表消失时刷新（含 worker、未打开终端的任务、崩溃恢复） */
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
    } catch (e: any) {
      if (e.name === "AbortError") throw new Error("上传超时，请检查网络后重试");
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const videoUploadProps = useMemo(
    () => ({
      maxCount: 1,
      beforeUpload: async (file: File) => {
        try {
          const key = await uploadOne(file);
          setVideoFileKey(key);
          message.success(`上传成功: ${key}`);
        } catch (e: any) {
          message.error(e.message || "上传失败");
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
        } catch (e: any) {
          message.error(e.message || "上传失败");
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
      const payloadBase: any = {
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
          ? { ...payloadBase, videoFileKey }
          : {
              ...payloadBase,
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
        } catch (e: any) {
          if (createdCount > 0) {
            message.success(`已创建 ${createdCount}/${accountNames.length} 个任务`);
          }
          throw new Error(
            `为「${accountName}」创建任务失败` +
              (createdCount > 0 ? `（已完成 ${createdCount}/${accountNames.length}）` : "") +
              `: ${e.message || "未知错误"}`
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
    } catch (e: any) {
      message.error(e.message || "创建任务失败");
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
    } catch (e: any) {
      message.error(e.message || "重试失败");
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
    } catch (e: any) {
      message.error(e.message || "立即执行失败");
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
    } catch (e: any) {
      message.error(e.message || "删除失败");
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
    } catch (e: any) {
      message.error(e.message || "启动任务失败");
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
        if (!res.ok) { failed++; continue; }
        deleted++;
      } catch { failed++; }
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
    } catch (e: any) {
      message.error(e.message || "终止失败");
    }
  }

  async function handleImportFromFeishu() {
    setImporting(true);
    try {
      const taskId = await startTask("/api/creator/publish/import-from-feishu", {}, "creator-publish");
      message.info(`导入任务已启动: ${taskId}`);
    } catch (e: any) {
      message.error(e.message || "启动导入失败");
    }
    setImporting(false);
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
    } catch (e: any) {
      message.error(e.message || "启动AI正文生成失败");
    }
    setGeneratingFeishuAi(false);
  }

  async function handleRefreshTasks() {
    try {
      await fetchTasks();
      message.success("任务列表已刷新");
    } catch (e: any) {
      message.error(e.message || "刷新失败");
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
    } catch (e: any) {
      message.error(e.message || "保存失败");
    }
    setSavingEdit(false);
  }

  function renderMultilineText(value?: string, lines = 2, opts?: { showNativeTitle?: boolean }) {
    if (!value) return "-";
    const showNativeTitle = opts?.showNativeTitle !== false;
    return (
      <div
        title={showNativeTitle ? value : undefined}
        style={lines === 2 ? MULTILINE_TEXT_STYLE : { ...MULTILINE_TEXT_STYLE, WebkitLineClamp: lines }}
      >
        {value}
      </div>
    );
  }

  function renderHoverPreview(value?: string, placeholder = "-") {
    if (!value) return placeholder;
    return (
      <Popover
        trigger="hover"
        placement="topLeft"
        styles={{ root: { maxWidth: 420 } }}
        content={
          <div
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxWidth: 380,
              lineHeight: 1.6,
            }}
          >
            {value}
          </div>
        }
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 22,
            color: "#2563eb",
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontSize: 12,
          }}
        >
          {placeholder}
        </span>
      </Popover>
    );
  }

  async function copyTaskId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      message.success("已复制任务 ID");
    } catch {
      message.error("复制失败，请手动选择复制");
    }
  }

  function renderCopyableTaskId(id?: string) {
    if (!id) return "-";
    return (
      <Tooltip title={`${id}（点击复制）`}>
        <Text
          code
          style={{
            fontSize: 11,
            cursor: "copy",
            maxWidth: 116,
            display: "inline-block",
            margin: 0,
          }}
          ellipsis
          onClick={() => void copyTaskId(id)}
        >
          {id}
        </Text>
      </Tooltip>
    );
  }

  const columns = [
    {
      title: "任务ID",
      dataIndex: "id",
      align: "center" as const,
      width: 128,
      render: (id: string) => renderCopyableTaskId(id),
    },
    {
      title: "账号",
      dataIndex: "accountName",
      align: "center" as const,
      width: 128,
      render: (value: string) => renderMultilineText(value, 2),
    },
    {
      title: "类型",
      align: "center" as const,
      width: 56,
      render: (_: any, r: PublishTask) => (r.payload.type === "video" ? "视频" : "图文"),
    },
    {
      title: "标题",
      width: 78,
      align: "center" as const,
      render: (_: any, r: PublishTask) => {
        const title = String(r.payload.title ?? "").trim();
        if (!title) return "-";
        return renderHoverPreview(title, "查看标题");
      },
    },
    {
      title: "正文",
      width: 78,
      align: "center" as const,
      render: (_: any, r: PublishTask) => renderHoverPreview(r.payload.description || "", "查看正文"),
    },
    {
      title: "定时",
      key: "scheduleAt",
      align: "center" as const,
      width: 112,
      sorter: (a: PublishTask, b: PublishTask) =>
        getPublishTaskScheduleSortValue(a) - getPublishTaskScheduleSortValue(b),
      sortOrder: scheduleColumnSortOrder === null ? undefined : scheduleColumnSortOrder,
      showSorterTooltip: { title: "按定时排序：升序为时间从早到晚，「立即」在最前" },
      render: (_: any, r: PublishTask) =>
        r.payload.scheduleAt ? dayjs(r.payload.scheduleAt).format("MM-DD HH:mm") : "立即",
    },
    {
      title: "挂车链接",
      width: 84,
      align: "center" as const,
      render: (_: any, r: PublishTask) => {
        const link = r.payload.productLink || "";
        if (!link) return "-";
        return (
          <Popover
            trigger="hover"
            placement="topLeft"
            styles={{ root: { maxWidth: 420 } }}
            content={
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  maxWidth: 380,
                  lineHeight: 1.6,
                }}
              >
                <a href={link} target="_blank" rel="noreferrer">
                  {link}
                </a>
              </div>
            }
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 22,
                color: "#2563eb",
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontSize: 12,
              }}
            >
              查看链接
            </span>
          </Popover>
        );
      },
    },
    {
      title: "AI内容",
      width: 70,
      align: "center" as const,
      render: (_: any, r: PublishTask) => (
        <Tag
          style={
            r.payload.isAiContent
              ? {
                  marginInlineEnd: 0,
                  background: "#111111",
                  color: "#ffffff",
                  borderColor: "#111111",
                }
              : {
                  marginInlineEnd: 0,
                  background: "#ebe7e1",
                  color: "#626260",
                  borderColor: "#d3cec6",
                }
          }
        >
          {r.payload.isAiContent ? "是" : "否"}
        </Tag>
      ),
    },
    {
      title: "广审批文号",
      width: 112,
      render: (_: any, r: PublishTask) => renderMultilineText(r.payload.approvalNumber || "", 2),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 72,
      align: "center" as const,
      render: (s: TaskStatus) => {
        const v = STATUS_MAP[s];
        return <Tag style={antdTagPresetStyle(v.color)}>{v.text}</Tag>;
      },
    },
    {
      title: "飞书行",
      dataIndex: "feishuRowNumber",
      width: 72,
      align: "center" as const,
      render: (v?: number) => (Number.isFinite(v) ? String(v) : "-"),
    },
    {
      title: "错误",
      align: "left" as const,
      onCell: () => ({
        style: {
          minWidth: 180,
        },
      }),
      render: (_: any, r: PublishTask) =>
        r.lastError ? (
          <Tooltip
            title={r.lastError}
            placement="topLeft"
            mouseEnterDelay={0.15}
            styles={{
              root: { maxWidth: 480 },
              body: {
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
                lineHeight: 1.5,
                maxHeight: "min(60vh, 360px)",
                overflowX: "hidden",
                overflowY: "auto",
              },
            }}
          >
            <span style={{ display: "block", width: "100%", cursor: "default" }}>
              <Typography.Text type="danger">
                {renderMultilineText(r.lastError, 2, { showNativeTitle: false })}
              </Typography.Text>
            </span>
          </Tooltip>
        ) : null,
    },
    {
      title: "更新时间",
      key: "taskDisplayTime",
      width: 100,
      align: "center" as const,
      render: (_: unknown, r: PublishTask) =>
        dayjs(r.displayUpdatedAt ?? r.updatedAt ?? r.createdAt).format("MM-DD HH:mm"),
    },
    {
      title: "操作",
      width: 132,
      align: "center" as const,
      render: (_: any, r: PublishTask) => (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            columnGap: 2,
            rowGap: 2,
            justifyItems: "center",
          }}
        >
          <Button
            size="small"
            type="link"
            style={TASK_TABLE_OP_LINK_STYLE}
            disabled={!r.taskId}
            onClick={() => {
              if (r.taskId) {
                const stillRunning = runningTasks.some((t) => t.taskId === r.taskId);
                selectTaskLog(r.taskId, !stillRunning && (r.status === "success" || r.status === "failed"));
              }
            }}
          >
            日志
          </Button>
          <Button
            size="small"
            type="link"
            style={TASK_TABLE_OP_LINK_STYLE}
            disabled={r.status !== "failed" && r.status !== "cancelled" && r.status !== "success" || isNamespaceBusy("creator-publish")}
            onClick={() => handleRetryTask(r)}
          >
            重试
          </Button>
          <Button
            size="small"
            type="link"
            style={TASK_TABLE_OP_LINK_STYLE}
            disabled={r.status === "running"}
            onClick={() => openEditTask(r)}
          >
            编辑
          </Button>
          {r.status === "pending" && (
            <Button
              size="small"
              type="link"
              style={TASK_TABLE_OP_LINK_STYLE}
              onClick={() => handleRunNow(r)}
            >
              执行
            </Button>
          )}
          <Popconfirm
            title="确认删除任务？"
            description={
              <div style={{ color: "var(--vol-body)" }}>
                将删除任务：<Text code>{r.id}</Text>
                <br />
                <Text type="secondary">账号：{r.accountName}</Text>
              </div>
            }
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            placement="top"
            onConfirm={() => handleDeleteTask(r)}
          >
            <Button size="small" type="link" danger style={TASK_TABLE_OP_LINK_STYLE}>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const runningCount = tasks.filter((t) => t.status === "running").length;

  const formContent = (
    <div style={{ width: "100%" }}>
      <Space orientation="vertical" size={6} style={{ width: "100%" }}>
        <Card size="small" styles={{ body: { paddingTop: 8 } }}>
        <Space orientation="vertical" size={6} style={{ width: "100%" }}>
          <Form layout="vertical" colon={false} requiredMark={false}>
            <Form.Item label="发布类型" style={{ marginBottom: 8 }}>
              <Radio.Group
                value={type}
                onChange={(e) => setType(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { label: "发布视频", value: "video" },
                  { label: "发布图文", value: "article" },
                ]}
              />
            </Form.Item>

            <Form.Item
              label="选择账号"
              style={{ marginBottom: 8 }}
              help={
                <span style={{ fontSize: 11, color: "var(--vol-mute)" }}>
                  {loadingAccounts ? "加载中..." : "多选会为每个账号创建一条任务"}
                </span>
              }
            >
              <Select
                mode="multiple"
                allowClear
                value={accountNames}
                onChange={setAccountNames}
                options={accountOptions}
                loading={loadingAccounts}
                placeholder="请选择抖创账号"
              />
            </Form.Item>

            {type === "video" && (
              <Form.Item label="上传视频" style={{ marginBottom: 8 }}>
                <Upload {...videoUploadProps} accept="video/*" showUploadList={false}>
                  <Button>选择视频文件</Button>
                </Upload>
                {videoFileKey && (
                  <div style={{ marginTop: 6 }}>
                    <Text type="secondary">已上传: </Text>
                    <Text code>{videoFileKey}</Text>
                  </div>
                )}
              </Form.Item>
            )}

            {type === "article" && (
              <>
                <Form.Item label="上传图片（多张）" style={{ marginBottom: 8 }}>
                  <Upload {...imageUploadProps} accept="image/*" showUploadList={false}>
                    <Button>选择图片文件</Button>
                  </Upload>
                  {imageKeys.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <Text type="secondary">已上传 {imageKeys.length} 张</Text>
                    </div>
                  )}
                </Form.Item>

                <Form.Item label="封面（可选）" style={{ marginBottom: 8 }}>
                  <Select
                    allowClear
                    placeholder="不选则默认第一张"
                    value={coverImageKey}
                    onChange={(v) => setCoverImageKey(v)}
                    options={coverOptions}
                    disabled={imageKeys.length === 0}
                  />
                </Form.Item>
              </>
            )}

            <Form.Item label="商品链接" style={{ marginBottom: 8 }}>
              <Input
                value={productLink}
                onChange={(e) => setProductLink(e.target.value)}
                placeholder="用于自动切换为购物车并粘贴商品链接"
              />
            </Form.Item>

            <Form.Item label="标题" style={{ marginBottom: 8 }}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
            </Form.Item>

            <Form.Item label="描述" style={{ marginBottom: 8 }}>
              <Input.TextArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="描述"
                autoSize={{ minRows: 2, maxRows: 6 }}
              />
            </Form.Item>

            <Form.Item label="商品标题" style={{ marginBottom: 8 }}>
              <Input
                value={productTitle}
                onChange={(e) => setProductTitle(e.target.value)}
                placeholder="商品短标题，用于商品编辑弹窗自动填写"
              />
            </Form.Item>

            <Form.Item label="广审批文号" style={{ marginBottom: 8 }}>
              <Input
                value={approvalNumber}
                onChange={(e) => setApprovalNumber(e.target.value)}
                placeholder="不包含广审内容"
              />
            </Form.Item>

            <Form.Item
              label="AI内容"
              style={{ marginBottom: 8 }}
              help={
                <span style={{ fontSize: 11, color: "var(--vol-mute)" }}>
                  开启后自主声明选"内容由AI生成"，关闭则选"无需添加自主声明"
                </span>
              }
            >
              <Switch
                checked={isAiContent}
                onChange={setIsAiContent}
                checkedChildren="是"
                unCheckedChildren="否"
              />
            </Form.Item>

            <Form.Item
              label="定时发布时间（可选）"
              style={{ marginBottom: 8 }}
              help={
                <span style={{ fontSize: 11, color: "var(--vol-mute)" }}>
                  不填则立即发布 | 不可选择过去时间
                </span>
              }
            >
              <DatePicker
                showTime={SCHEDULE_SHOW_TIME}
                format="YYYY-MM-DD HH:mm"
                allowClear
                placeholder="选择定时发布时间"
                value={scheduleAt ? dayjs(scheduleAt) : null}
                onChange={(v) => setScheduleAt(v ? v.toISOString() : null)}
                disabledDate={scheduleDisabledDate}
                disabledTime={scheduleDisabledTime}
                presets={schedulePresets}
                style={{ width: "100%" }}
              />
            </Form.Item>

            <Space>
              <Button type="primary" onClick={handleCreateTasks} loading={creating}>
                创建任务
              </Button>
            </Space>
          </Form>
        </Space>
        </Card>
      </Space>
    </div>
  );

  const taskListContent = (
      <>
        <div
          style={{
            marginBottom: 8,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Space size={8} wrap>
            <Select
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              value={taskTypeFilters}
              onChange={setTaskTypeFilters}
              options={TASK_TYPE_OPTIONS}
              style={{ minWidth: 120, maxWidth: 200 }}
              size="small"
              popupMatchSelectWidth={false}
              placeholder="全部类型"
              aria-label="按类型筛选任务"
            />
            <Select
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              value={taskStatusFilters}
              onChange={setTaskStatusFilters}
              options={TASK_STATUS_SELECT_OPTIONS}
              style={{ minWidth: 160, maxWidth: 320 }}
              size="small"
              popupMatchSelectWidth={false}
              placeholder="全部状态"
              aria-label="按状态筛选任务"
            />
            <Select
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              value={taskShopFilters}
              onChange={setTaskShopFilters}
              options={taskShopSelectOptions}
              style={{ minWidth: 180, maxWidth: 320 }}
              size="small"
              showSearch
              optionFilterProp="label"
              popupMatchSelectWidth={false}
              placeholder="全部店铺"
              aria-label="按店铺筛选任务"
            />
          </Space>
          <Space size={4} wrap>
          <Button
            type="primary"
            size="small"
            disabled={selectedRowKeys.length === 0}
            onClick={handleStartTasks}
          >
            启动任务 ({selectedRowKeys.length})
          </Button>
          <Popconfirm
            title="确认终止选中任务？"
            description={`将终止 ${terminableSelectedRowKeys.length} 个选中的队列中/执行中任务，其他状态会被忽略`}
            okText="终止"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={handleKillSelected}
          >
            <Button danger size="small" disabled={terminableSelectedRowKeys.length === 0}>
              终止选中 ({terminableSelectedRowKeys.length})
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确认批量删除？"
            description={`将删除 ${selectedRowKeys.length} 个任务，此操作不可恢复`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={handleBatchDelete}
          >
            <Button danger size="small" disabled={selectedRowKeys.length === 0}>
              删除选中 ({selectedRowKeys.length})
            </Button>
          </Popconfirm>
          <Popover
            trigger="hover"
            placement="bottomRight"
            content={
              <Space orientation="vertical" size={8} style={{ minWidth: 200 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>AI 模型选择</Text>
                <Select
                  value={feishuAiProvider}
                  onChange={setFeishuAiProvider}
                  style={{ width: "100%" }}
                  options={[
                    { label: "SiliconFlow", value: "siliconflow" },
                    { label: "DeepSeek", value: "deepseek" },
                  ]}
                />
              </Space>
            }
          >
            <Button
              type="primary"
              size="small"
              onClick={handleGenerateFeishuAiContent}
              loading={generatingFeishuAi}
              disabled={isNamespaceBusy("creator-publish")}
            >
              AI生成正文
            </Button>
          </Popover>
          <Button
            type="primary"
            size="small"
            onClick={handleImportFromFeishu}
            loading={importing}
            disabled={isNamespaceBusy("creator-publish")}
          >
            从飞书导入任务
          </Button>
          <Button onClick={handleRefreshTasks} loading={loadingTasks} size="small">
            刷新任务
          </Button>
          </Space>
        </div>
        <Table
        rowKey="id"
        size="small"
        bordered
        loading={loadingTasks}
        dataSource={filteredTasks}
        columns={columns as any}
        tableLayout="fixed"
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 1388, y: "calc(100vh - 220px)" }}
        onChange={(_pagination, _filters, sorter, extra) => {
          if (extra.action !== "sort") return;
          const s = Array.isArray(sorter) ? sorter[0] : sorter;
          setScheduleColumnSortOrder((s?.order ?? null) as "ascend" | "descend" | null);
        }}
        rowSelection={rowSelection}
        style={{ width: "100%" }}
        onRow={handleRow}
      />
      <Modal
        title="编辑任务"
        open={Boolean(editingTask && editState)}
        onCancel={closeEditTask}
        onOk={handleSaveEditTask}
        confirmLoading={savingEdit}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
        centered
        width={560}
        styles={{
          body: {
            paddingTop: 12,
            paddingBottom: 12,
            maxHeight: "calc(100vh - 180px)",
            overflowY: "auto",
            overflowX: "hidden",
          },
        }}
        style={{ top: 24 }}
      >
        {editingTask && editState ? (
          <Form
            layout="vertical"
            colon={false}
            requiredMark={false}
            style={{ marginBottom: 0 }}
          >
            <Form.Item
              label="店铺/账号"
              style={{ marginBottom: 10 }}
              help={
                <span style={{ fontSize: 11, color: "var(--vol-mute)" }}>
                  切换到其它账号后，任务将以新账号的登录态执行（须已在全局配置中添加该抖创账号）
                </span>
              }
            >
              <Select
                showSearch
                optionFilterProp="label"
                value={editState.accountName || undefined}
                onChange={(v) =>
                  setEditState((prev) => (prev ? { ...prev, accountName: v } : prev))
                }
                options={editAccountSelectOptions}
                loading={loadingAccounts}
                placeholder="选择店铺/抖创账号"
                popupMatchSelectWidth={false}
              />
            </Form.Item>
            <Form.Item label="类型" style={{ marginBottom: 10 }}>
              <Input value={editingTask.payload.type === "video" ? "视频" : "图文"} disabled />
            </Form.Item>
            <Form.Item label="标题" style={{ marginBottom: 10 }}>
              <Input
                value={editState.title}
                onChange={(e) => setEditState((prev) => prev ? { ...prev, title: e.target.value } : prev)}
              />
            </Form.Item>
            <Form.Item label="正文" style={{ marginBottom: 10 }}>
              <Input.TextArea
                value={editState.description}
                onChange={(e) => setEditState((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                autoSize={{ minRows: 4, maxRows: 8 }}
              />
            </Form.Item>
            <Form.Item label="挂车链接" style={{ marginBottom: 10 }}>
              <Input
                value={editState.productLink}
                onChange={(e) => setEditState((prev) => prev ? { ...prev, productLink: e.target.value } : prev)}
              />
            </Form.Item>
            <Form.Item label="商品标题" style={{ marginBottom: 10 }}>
              <Input
                value={editState.productTitle}
                onChange={(e) => setEditState((prev) => prev ? { ...prev, productTitle: e.target.value } : prev)}
              />
            </Form.Item>
            <Form.Item label="广审批文号" style={{ marginBottom: 10 }}>
              <Input
                value={editState.approvalNumber}
                onChange={(e) => setEditState((prev) => prev ? { ...prev, approvalNumber: e.target.value } : prev)}
              />
            </Form.Item>
            <Form.Item label="AI内容" style={{ marginBottom: 10 }}>
              <Switch
                checked={editState.isAiContent}
                onChange={(checked) => setEditState((prev) => prev ? { ...prev, isAiContent: checked } : prev)}
                checkedChildren="是"
                unCheckedChildren="否"
              />
            </Form.Item>
            <Form.Item
              label="定时发布时间"
              style={{ marginBottom: 0 }}
              help={
                <span style={{ fontSize: 11, color: "var(--vol-mute)" }}>
                  选「立即执行」尽快跑任务；定时时先选日期，时间用下拉（可搜索、无滚轮跳动）；亦可点下方快捷时间
                </span>
              }
            >
              <Space orientation="vertical" size={10} style={{ width: "100%" }}>
                <Segmented
                  block
                  value={editState.scheduleAt ? "scheduled" : "immediate"}
                  onChange={(v) => {
                    if (v === "immediate") {
                      setEditState((prev) => (prev ? { ...prev, scheduleAt: null } : prev));
                    } else {
                      setEditState((prev) => {
                        if (!prev) return prev;
                        if (prev.scheduleAt) return prev;
                        return { ...prev, scheduleAt: defaultFutureScheduleIso() };
                      });
                    }
                  }}
                  options={[
                    { label: "立即执行", value: "immediate" },
                    { label: "定时发布", value: "scheduled" },
                  ]}
                />
                {editState.scheduleAt ? (
                  <>
                    <Space.Compact block>
                      <DatePicker
                        style={{ width: "52%" }}
                        format="YYYY-MM-DD"
                        allowClear={false}
                        placeholder="日期"
                        value={dayjs(editState.scheduleAt).isValid() ? dayjs(editState.scheduleAt) : null}
                        onChange={(d) => {
                          setEditState((prev) => {
                            if (!prev?.scheduleAt || !d) return prev;
                            const cur = dayjs(prev.scheduleAt);
                            if (!cur.isValid()) return { ...prev, scheduleAt: defaultFutureScheduleIso() };
                            let merged = d.hour(cur.hour()).minute(cur.minute()).second(0).millisecond(0);
                            if (merged.isBefore(dayjs())) {
                              const opts = buildScheduleTimeOptionsForDay(merged);
                              if (opts.length > 0) {
                                const [hs, ms] = opts[0].value.split(":");
                                merged = d
                                  .hour(parseInt(hs, 10))
                                  .minute(parseInt(ms, 10))
                                  .second(0)
                                  .millisecond(0);
                              } else {
                                merged = dayjs(defaultFutureScheduleIso());
                              }
                            }
                            return { ...prev, scheduleAt: merged.toISOString() };
                          });
                        }}
                        disabledDate={scheduleDisabledDate}
                        getPopupContainer={() => document.body}
                        styles={{ popup: { root: { zIndex: 1100 } } }}
                      />
                      <Select
                        style={{ width: "48%" }}
                        placeholder="时间"
                        allowClear={false}
                        showSearch={{ optionFilterProp: "label" }}
                        getPopupContainer={() => document.body}
                        popupMatchSelectWidth={false}
                        listHeight={280}
                        options={editScheduleTimeOptions}
                        notFoundContent="所选日期暂无可选时刻，请换一天"
                        value={
                          dayjs(editState.scheduleAt).isValid()
                            ? dayjs(editState.scheduleAt).format("HH:mm")
                            : undefined
                        }
                        onChange={(hm) => {
                          if (!hm) return;
                          const parts = hm.split(":");
                          const hh = parseInt(parts[0], 10);
                          const mm = parseInt(parts[1], 10);
                          if (!Number.isFinite(hh) || !Number.isFinite(mm)) return;
                          setEditState((prev) => {
                            if (!prev?.scheduleAt) return prev;
                            const cur = dayjs(prev.scheduleAt);
                            if (!cur.isValid()) return { ...prev, scheduleAt: defaultFutureScheduleIso() };
                            const merged = cur.hour(hh).minute(mm).second(0).millisecond(0);
                            if (merged.isBefore(dayjs())) return prev;
                            return { ...prev, scheduleAt: merged.toISOString() };
                          });
                        }}
                        styles={{ popup: { root: { zIndex: 1100 } } }}
                      />
                    </Space.Compact>
                    <div>
                      <Text type="secondary" style={{ fontSize: 11, marginBottom: 4, display: "block" }}>
                        快捷时间
                      </Text>
                      <Space size={[6, 6]} wrap>
                        {schedulePresets.map((p) => (
                          <Button
                            key={p.label}
                            size="small"
                            type="default"
                            onClick={() =>
                              setEditState((prev) =>
                                prev ? { ...prev, scheduleAt: p.value.toISOString() } : prev
                              )
                            }
                          >
                            {p.label}
                          </Button>
                        ))}
                      </Space>
                    </div>
                  </>
                ) : null}
              </Space>
            </Form.Item>
          </Form>
        ) : null}
      </Modal>
      </>
    );

    const tabItems = [
      {
        key: "create",
        label: "创建任务",
        children: formContent,
      },
      {
        key: "tasks",
        label: (
          <Badge count={runningCount} size="small" offset={[6, 0]}>
            <span style={{ paddingRight: 4 }}>任务列表</span>
          </Badge>
        ),
        children: taskListContent,
      },
    ];

    return (
      <Tabs
        defaultActiveKey="tasks"
        items={tabItems}
        size="small"
        style={{ width: "100%" }}
        tabBarStyle={{ marginBottom: 12 }}
        onChange={(key) => {
          if (key === "tasks") fetchTasks();
        }}
      />
    );
  }
