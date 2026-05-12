"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Popover,
  Popconfirm,
  Tooltip,
} from "antd";
import { ReloadOutlined, DeleteOutlined, LinkOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useTaskContext } from "@/contexts/TaskContext";
import type { ReviewItem, ReviewStatus } from "@/types";

const { Text } = Typography;

const REVIEW_STATUS_MAP: Record<ReviewStatus, { color: string; text: string }> = {
  under_review: { color: "processing", text: "审核中" },
  approved: { color: "success", text: "已通过" },
  rejected: { color: "error", text: "未通过" },
};

const STATUS_FILTER_OPTIONS = [
  { label: "全部", value: "all" },
  { label: "审核中", value: "under_review" },
  { label: "已通过", value: "approved" },
  { label: "未通过", value: "rejected" },
];

function workDetailUrl(postId: string) {
  return `https://creator.douyin.com/creator-micro/work-management/work-detail/${encodeURIComponent(
    postId
  )}?enter_from=content`;
}

function isReviewScreenshotPath(value?: string) {
  return Boolean(value && /storage\/creator-accounts\/.+\.png$/i.test(value));
}

function screenshotUrl(value: string) {
  return `/api/review/screenshot?path=${encodeURIComponent(value)}`;
}

function renderRejectionReason(item: ReviewItem) {
  const value = item.rejectionScreenshotPath || item.rejectionReason;
  if (!value) return "-";

  if (isReviewScreenshotPath(value)) {
    const src = screenshotUrl(value);
    return (
      <Popover
        trigger="hover"
        placement="topLeft"
        content={
          <img
            src={src}
            alt="审核详情截图"
            style={{ display: "block", maxWidth: 520, maxHeight: 420, objectFit: "contain" }}
          />
        }
      >
        <img
          src={src}
          alt="审核详情截图"
          style={{
            display: "block",
            width: 96,
            height: 56,
            objectFit: "cover",
            borderRadius: 4,
            border: "1px solid #f0f0f0",
            cursor: "zoom-in",
          }}
        />
      </Popover>
    );
  }

  return (
    <Typography.Text type="danger" style={{ fontSize: 12 }}>
      {value.length > 60 ? `${value.slice(0, 60)}...` : value}
    </Typography.Text>
  );
}

export default function ReviewPage() {
  const { message } = App.useApp();
  const { isNamespaceBusy, startTask } = useTaskContext();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [accounts, setAccounts] = useState<{ name: string }[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

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

  const fetchItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const res = await fetch("/api/review/list");
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      message.error("获取审核记录失败");
    }
    setLoadingItems(false);
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchItems();
  }, [fetchAccounts, fetchItems]);

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ label: a.name, value: a.name })),
    [accounts]
  );

  const filteredItems = useMemo(() => {
    let result = items;
    if (accountFilter !== "all") {
      result = result.filter((item) => item.accountName === accountFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((item) => item.reviewStatus === statusFilter);
    }
    return result;
  }, [items, statusFilter, accountFilter]);

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/review/delete?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      message.success("已删除");
      fetchItems();
    } catch (e: any) {
      message.error(e.message || "删除失败");
    }
  }

  async function handleBatchDelete() {
    if (selectedRowKeys.length === 0) {
      message.warning("请先勾选要删除的记录");
      return;
    }
    try {
      const res = await fetch("/api/review/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedRowKeys }),
      });
      if (!res.ok) throw new Error("删除失败");
      const data = await res.json();
      message.success(`已删除 ${data.deleted || selectedRowKeys.length} 条`);
      setSelectedRowKeys([]);
      fetchItems();
    } catch (e: any) {
      message.error(e.message || "批量删除失败");
    }
  }

  async function handleFetchReviewStatus() {
    if (selectedAccounts.length === 0) {
      message.warning("请选择至少一个账号");
      return;
    }

    setFetching(true);
    try {
      const taskId = await startTask(
        "/api/review/check",
        { accounts: selectedAccounts },
        "review"
      );
      message.info(`审核抓取任务已启动: ${taskId}`);
    } catch (e: any) {
      message.error(e.message || "启动审核抓取失败");
    }
    setFetching(false);
  }

  async function handleOpenWorkDetail(item: ReviewItem) {
    if (item.reviewStatus !== "approved") {
      message.warning("只有已发布作品可以打开详情页");
      return;
    }
    if (!item.postId) {
      message.warning("缺少作品 ID，无法打开详情页");
      return;
    }

    try {
      const taskId = await startTask(
        "/api/creator/open",
        {
          accountName: item.accountName,
          targetUrl: workDetailUrl(item.postId),
        },
        "system"
      );
      message.info(`正在用 ${item.accountName} 的登录态打开作品详情: ${taskId}`);
    } catch (e: any) {
      message.error(e.message || "打开作品详情失败");
    }
  }

  const columns = [
    {
      title: "账号",
      dataIndex: "accountName",
      align: "center" as const,
      width: 100,
      render: (v: string) => (
        <div
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
            wordBreak: "break-word",
            lineHeight: 1.5,
          }}
        >
          {v}
        </div>
      ),
    },
    {
      title: "标题",
      align: "center" as const,
      width: 140,
      render: (_: any, r: ReviewItem) => {
        const title = r.title?.trim();
        if (!title) return "-";
        return (
          <Popover
            trigger="hover"
            placement="topLeft"
            styles={{ root: { maxWidth: 420 } }}
            content={
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}>
                {title}
              </div>
            }
          >
            <div
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
                wordBreak: "break-word",
                lineHeight: 1.5,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              {title}
            </div>
          </Popover>
        );
      },
    },
    {
      title: "发布时间",
      dataIndex: "publishDate",
      align: "center" as const,
      width: 80,
      render: (v: string) => {
        if (!v) return "-";
        const d = dayjs(v);
        return d.isValid() ? d.format("MM-DD HH:mm") : "-";
      },
    },
    {
      title: "审核状态",
      dataIndex: "reviewStatus",
      align: "center" as const,
      width: 70,
      render: (s: ReviewStatus) => {
        const v = REVIEW_STATUS_MAP[s] || { color: "default", text: "未知" };
        return <Tag color={v.color}>{v.text}</Tag>;
      },
    },
    {
      title: "拒绝原因",
      dataIndex: "rejectionReason",
      width: 160,
      render: (_: string | undefined, r: ReviewItem) => renderRejectionReason(r),
    },
    {
      title: "最近检查",
      dataIndex: "checkedAt",
      align: "center" as const,
      width: 80,
      render: (v: string) => {
        if (!v) return "-";
        const d = dayjs(v);
        return d.isValid() ? d.format("MM-DD HH:mm") : "-";
      },
    },
    {
      title: "操作",
      align: "center" as const,
      width: 80,
      render: (_: any, r: ReviewItem) => {
        const canOpenDetail = r.reviewStatus === "approved" && Boolean(r.postId);
        return (
          <Space size={0}>
            <Tooltip title={canOpenDetail ? "用该店铺登录态打开作品详情" : "只有已发布作品可以打开详情"}>
              <Button
                type="text"
                size="small"
                icon={<LinkOutlined />}
                disabled={!canOpenDetail}
                onClick={() => handleOpenWorkDetail(r)}
              />
            </Tooltip>
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(r.id)}
            />
          </Space>
        );
      },
    },
  ];

  const underReviewCount = items.filter((i) => i.reviewStatus === "under_review").length;
  const rejectedCount = items.filter((i) => i.reviewStatus === "rejected").length;
  const approvedCount = items.filter((i) => i.reviewStatus === "approved").length;

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          marginBottom: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <Space size={8} wrap>
          <Select
            mode="multiple"
            allowClear
            style={{ minWidth: 240 }}
            value={selectedAccounts}
            onChange={setSelectedAccounts}
            options={accountOptions}
            loading={loadingAccounts}
            placeholder="选择账号"
            maxTagCount={3}
          />
          <Button
            type="primary"
            onClick={handleFetchReviewStatus}
            loading={fetching}
            disabled={isNamespaceBusy("review")}
            icon={<ReloadOutlined />}
          >
            抓取审核状态
          </Button>
        </Space>

        <Space size={8} wrap>
          {selectedRowKeys.length > 0 && (
            <Popconfirm
              title={`确定删除选中的 ${selectedRowKeys.length} 条记录？`}
              onConfirm={handleBatchDelete}
              okText="确定"
              cancelText="取消"
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {items.length} 条
          </Text>
          {approvedCount > 0 && (
            <Tag color="success" style={{ margin: 0 }}>
              通过 {approvedCount}
            </Tag>
          )}
          {underReviewCount > 0 && (
            <Tag color="processing" style={{ margin: 0 }}>
              审核 {underReviewCount}
            </Tag>
          )}
          {rejectedCount > 0 && (
            <Tag color="error" style={{ margin: 0 }}>
              拒绝 {rejectedCount}
            </Tag>
          )}
        </Space>
      </div>

      <div style={{ marginBottom: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Select
          size="small"
          style={{ width: 120 }}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
          options={STATUS_FILTER_OPTIONS}
        />
        <Select
          size="small"
          style={{ width: 160 }}
          value={accountFilter}
          onChange={(v) => setAccountFilter(v)}
          options={[{ label: "全部账号", value: "all" }, ...accountOptions]}
        />
      </div>

      <Table
        rowKey="id"
        size="small"
        bordered
        loading={loadingItems}
        dataSource={filteredItems}
        columns={columns as any}
        tableLayout="fixed"
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        scroll={{ x: 820, y: "calc(100vh - 260px)" }}
        locale={{ emptyText: "暂无审核记录，请先选择账号并点击「抓取审核状态」" }}
        style={{ width: "100%" }}
      />
    </div>
  );
}
