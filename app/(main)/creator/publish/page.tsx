"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Upload,
  Typography,
} from "antd";
import dayjs from "dayjs";
import type { CreatorAccount } from "@/types";
import { useTaskContext } from "@/contexts/TaskContext";

const { Text } = Typography;

type TaskType = "video" | "article";

type TaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";

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
  const { clearLogs, setTaskId } = useTaskContext();
  const [selectedRuntimeTaskId, setSelectedRuntimeTaskId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<CreatorAccount[]>([]);
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [creating, setCreating] = useState(false);

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
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);

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
    if (type === "article" && !productLink.trim()) {
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
        scheduleAt,
      };

      const payload: TaskPayload =
        type === "video"
          ? { ...payloadBase, videoFileKey }
          : {
              ...payloadBase,
              imagesFileKeys: imageKeys,
              coverImageKey: coverImageKey || undefined,
              productLink: productLink.trim() || undefined,
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
      setScheduleAt(null);
      await fetchTasks();
    } catch (e: any) {
      message.error(e.message || "创建任务失败");
    }
    setCreating(false);
  }

  async function handleRetryTask(task: PublishTask) {
    if (task.status !== "failed" && task.status !== "cancelled") {
      message.warning("仅失败/已取消的任务可重试");
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

  const columns = [
    { title: "账号", dataIndex: "accountName" },
    {
      title: "类型",
      render: (_: any, r: PublishTask) => (r.payload.type === "video" ? "视频" : "图文"),
    },
    {
      title: "定时",
      render: (_: any, r: PublishTask) => r.payload.scheduleAt ? dayjs(r.payload.scheduleAt).format("YYYY-MM-DD HH:mm") : "立即",
    },
    {
      title: "状态",
      dataIndex: "status",
      render: (s: TaskStatus) => {
        const map: Record<TaskStatus, { color: string; text: string }> = {
          pending: { color: "default", text: "待执行" },
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
      render: (_: any, r: PublishTask) => r.lastError ? <Text type="danger">{r.lastError}</Text> : "",
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      render: (v: string) => dayjs(v).format("MM-DD HH:mm:ss"),
    },
    {
      title: "操作",
      render: (_: any, r: PublishTask) => (
        <Space size="small">
          <Button
            size="small"
            type="link"
            disabled={!r.taskId}
            onClick={() => setSelectedRuntimeTaskId(r.taskId || null)}
          >
            查看日志
          </Button>
          <Button
            size="small"
            type="link"
            disabled={r.status !== "failed" && r.status !== "cancelled"}
            onClick={() => handleRetryTask(r)}
          >
            重试
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={10} style={{ width: "100%" }}>
      <Card title="创建发布任务" size="small" styles={{ body: { paddingTop: 8 } }}>
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

                <Form.Item label="商品链接" style={{ marginBottom: 8 }}>
                  <Input
                    value={productLink}
                    onChange={(e) => setProductLink(e.target.value)}
                    placeholder="用于自动切换为购物车并粘贴商品链接"
                  />
                </Form.Item>
              </>
            )}

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
              label="定时发布时间（可选）"
              style={{ marginBottom: 8 }}
              help={
                <span style={{ fontSize: 11, color: "rgba(15,23,42,.45)" }}>
                  不填则任务创建后会尽快执行（由调度器扫描触发）
                </span>
              }
            >
              <DatePicker
                showTime
                value={scheduleAt ? dayjs(scheduleAt) : null}
                onChange={(v) => setScheduleAt(v ? v.toISOString() : null)}
                style={{ width: "100%" }}
              />
            </Form.Item>

            <Space>
              <Button type="primary" onClick={handleCreateTasks} loading={creating}>
                创建任务
              </Button>
              <Button onClick={fetchTasks} loading={loadingTasks}>
                刷新任务
              </Button>
            </Space>
          </Form>
        </Space>
      </Card>

      <Card title="任务列表" size="small" styles={{ body: { padding: 8 } }}>
        <Table
          rowKey="id"
          size="small"
          loading={loadingTasks}
          dataSource={tasks}
          columns={columns as any}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Card title="执行日志" size="small" styles={{ body: { padding: 8 } }}>
        <Space wrap style={{ marginBottom: 8 }}>
          <Select
            style={{ minWidth: 320 }}
            placeholder="选择任务以查看日志"
            allowClear
            value={selectedRuntimeTaskId}
            onChange={(v) => setSelectedRuntimeTaskId(v)}
            options={tasks
              .filter((t) => !!t.taskId)
              .map((t) => ({
                label: `${t.accountName} / ${t.payload.type === "video" ? "视频" : "图文"} / ${t.status}`,
                value: t.taskId as string,
              }))}
          />
          <Button
            onClick={() => {
              if (!selectedRuntimeTaskId) return;
              clearLogs();
              setTaskId(selectedRuntimeTaskId);
            }}
            disabled={!selectedRuntimeTaskId}
          >
            在侧边栏连接日志
          </Button>
        </Space>
        <div style={{ color: "rgba(15,23,42,.55)", fontSize: 12 }}>
          已在悬浮命令行面板连接日志
        </div>
      </Card>
    </Space>
  );
}
