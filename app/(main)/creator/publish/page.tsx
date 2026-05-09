"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Badge,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Upload,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useTaskContext } from "@/contexts/TaskContext";

const { Text } = Typography;

type TaskType = "video" | "article";

type TaskStatus = "pending" | "queued" | "running" | "success" | "failed" | "cancelled";

const TERMINABLE_TASK_STATUSES = new Set<TaskStatus>(["pending", "running"]);

function isTerminableTask(task: PublishTask) {
  return TERMINABLE_TASK_STATUSES.has(task.status);
}

type TaskPayload =
  | {
      type: "video";
      videoFileKey: string;
      title?: string;
      description?: string;
      scheduleAt?: string | null;
    }
  | {
      type: "article";
      imagesFileKeys: string[];
      title?: string;
      description?: string;
      scheduleAt?: string | null;
      coverImageKey?: string;
      productLink?: string;
    };

type PublishTask = {
  id: string;
  createdAt: string;
  updatedAt: string;
  accountName: string;
  status: TaskStatus;
  payload: TaskPayload;
  lastError?: string;
  taskId?: string;
};

export default function CreatorPublishPage() {
  const { message } = App.useApp();
  const { isNamespaceBusy, selectTaskLog, runningTasks, startTask } = useTaskContext();
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

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

  const terminableSelectedRowKeys = useMemo(() => {
    const selected = new Set(selectedRowKeys);
    return tasks.filter((task) => selected.has(task.id) && isTerminableTask(task)).map((task) => task.id);
  }, [selectedRowKeys, tasks]);

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ label: a.name, value: a.name })),
    [accounts]
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
    try {
      const res = await fetch("/api/creator/publish/tasks");
      const data = await res.json();
      setTasks(data.tasks || []);
      setSelectedRowKeys((prev) => {
        const ids = new Set((data.tasks || []).map((t: PublishTask) => t.id));
        return prev.filter((k) => ids.has(k));
      });
    } catch {
      message.error("获取任务列表失败");
    }
    setLoadingTasks(false);
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchTasks();
    const t = setInterval(fetchTasks, 2000);
    return () => clearInterval(t);
  }, [fetchAccounts, fetchTasks]);

  async function uploadOne(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/creator/publish/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "upload failed");
    return data.fileKey as string;
  }

  const videoUploadProps = {
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
  };

  const imageUploadProps = {
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
  };

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

      for (const accountName of accountNames) {
        const res = await fetch("/api/creator/publish/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountName, payload }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "创建任务失败");
      }

      message.success(`已创建 ${accountNames.length} 个任务`);
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
      message.warning("仅待执行/执行中的任务可终止");
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

  const columns = [
    { title: "账号", dataIndex: "accountName", align: "center" as const, ellipsis: true },
    {
      title: "类型",
      align: "center" as const,
      width: 48,
      render: (_: any, r: PublishTask) => (r.payload.type === "video" ? "视频" : "图文"),
    },
    {
      title: "定时",
      align: "center" as const,
      width: 120,
      render: (_: any, r: PublishTask) =>
        r.payload.scheduleAt ? dayjs(r.payload.scheduleAt).format("MM-DD HH:mm") : "立即",
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 64,
      align: "center" as const,
      render: (s: TaskStatus) => {
        const map: Record<TaskStatus, { color: string; text: string }> = {
          pending: { color: "default", text: "待执行" },
          queued: { color: "blue", text: "队列中" },
          running: { color: "processing", text: "执行中" },
          success: { color: "success", text: "成功" },
          failed: { color: "error", text: "失败" },
          cancelled: { color: "warning", text: "已取消" },
        };
        const v = map[s];
        return <Tag color={v.color}>{v.text}</Tag>;
      },
    },
    {
      title: "错误",
      align: "center" as const,
      render: (_: any, r: PublishTask) =>
        r.lastError ? (
          <Typography.Text type="danger" ellipsis={{ tooltip: r.lastError }} style={{ maxWidth: 240 }}>
            {r.lastError}
          </Typography.Text>
        ) : null,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 100,
      align: "center" as const,
      render: (v: string) => dayjs(v).format("MM-DD HH:mm"),
    },
    {
      title: "操作",
      width: 180,
      align: "center" as const,
      render: (_: any, r: PublishTask) => (
        <Space size={0} >
          <Button
            size="small"
            type="link"
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
            disabled={r.status !== "failed" && r.status !== "cancelled" && r.status !== "success" || isNamespaceBusy("creator-publish")}
            onClick={() => handleRetryTask(r)}
          >
            重试
          </Button>
          {r.status === "pending" && (
            <Button
              size="small"
              type="link"
              onClick={() => handleRunNow(r)}
            >
              执行
            </Button>
          )}
          <Popconfirm
            title="确认删除任务？"
            description={
              <div style={{ color: "rgba(15,23,42,.72)" }}>
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
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const runningCount = tasks.filter((t) => t.status === "running").length;

  const formContent = (
    <Space orientation="vertical" size={6} style={{ width: "100%" }}>
      <Button
        type="primary"
        onClick={handleImportFromFeishu}
        loading={importing}
        disabled={isNamespaceBusy("creator-publish")}
        block
      >
        从飞书导入任务
      </Button>
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
                <span style={{ fontSize: 11, color: "rgba(15,23,42,.45)" }}>
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
                <span style={{ fontSize: 11, color: "rgba(15,23,42,.45)" }}>
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
                <span style={{ fontSize: 11, color: "rgba(15,23,42,.45)" }}>
                  不填则立即发布 | 不可选择过去时间
                </span>
              }
            >
              <DatePicker
                showTime={{ format: "HH:mm", minuteStep: 5 }}
                format="YYYY-MM-DD HH:mm"
                allowClear
                placeholder="选择定时发布时间"
                value={scheduleAt ? dayjs(scheduleAt) : null}
                onChange={(v) => setScheduleAt(v ? v.toISOString() : null)}
                disabledDate={(current) => current && current.isBefore(dayjs().startOf("day"))}
                disabledTime={(current) => {
                  if (!current || !current.isSame(dayjs(), "day")) return {};
                  const now = dayjs();
                  return {
                    disabledHours: () => Array.from({ length: now.hour() }, (_, i) => i),
                    disabledMinutes: (h) =>
                      h === now.hour()
                        ? Array.from({ length: now.minute() + 1 }, (_, i) => i)
                        : [],
                  };
                }}
                presets={[
                  { label: "1小时后", value: dayjs().add(1, "hour").startOf("hour") },
                  { label: "2小时后", value: dayjs().add(2, "hour").startOf("hour") },
                  { label: "明天 09:00", value: dayjs().add(1, "day").hour(9).minute(0).second(0) },
                  { label: "明天 12:00", value: dayjs().add(1, "day").hour(12).minute(0).second(0) },
                  { label: "后天 09:00", value: dayjs().add(2, "day").hour(9).minute(0).second(0) },
                ]}
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
  );

    const taskListContent = (
      <>
        <div style={{ marginBottom: 8, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
          {selectedRowKeys.length > 0 && (
            <>
              <Button
                type="primary"
                size="small"
                onClick={handleStartTasks}
              >
                启动任务 ({selectedRowKeys.length})
              </Button>
              <Popconfirm
                title="确认终止选中任务？"
                description={`将终止 ${terminableSelectedRowKeys.length} 个选中的待执行/执行中任务，其他状态会被忽略`}
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
                <Button danger size="small">
                  删除选中 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            </>
          )}
          <Button onClick={fetchTasks} loading={loadingTasks} size="small">
            刷新任务
          </Button>
        </div>
        <Table
        rowKey="id"
        size="small"
        bordered
        loading={loadingTasks}
        dataSource={tasks}
        columns={columns as any}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ y: "calc(100vh - 220px)" }}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
      />
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
        defaultActiveKey="create"
        items={tabItems}
        size="small"
        style={{ width: "100%" }}
        onChange={(key) => {
          if (key === "tasks") fetchTasks();
        }}
      />
    );
  }

