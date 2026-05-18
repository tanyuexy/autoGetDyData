"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Button,
  DatePicker,
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
import dayjs, { type Dayjs } from "dayjs";
import { useTaskContext } from "@/contexts/TaskContext";
import type { ReviewItem, ReviewStatus } from "@/types";
import { antdTagPresetStyle, semanticTagStyle } from "@/lib/semanticTagStyles";

const { Text, Link: TextLink } = Typography;
const { RangePicker } = DatePicker;

const REVIEW_STATUS_MAP: Record<ReviewStatus, { color: string; text: string }> = {
  under_review: { color: "processing", text: "审核中" },
  approved: { color: "success", text: "已发布" },
  rejected: { color: "error", text: "未通过" },
  needs_optimization: { color: "warning", text: "需优化" },
};

const STATUS_FILTER_OPTIONS = [
  { label: "全部", value: "all" },
  { label: "已发布", value: "approved" },
  { label: "审核中", value: "under_review" },
  { label: "需优化", value: "needs_optimization" },
  { label: "未通过", value: "rejected" },
];

/** 工具栏账号多选的「一键全选」，不会作为真实账号名传给接口 */
const MULTI_SELECT_ALL_ACCOUNTS = "__toolbar_all_creator_accounts__";

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
    <Popover
      trigger="hover"
      placement="topLeft"
      styles={{ root: { maxWidth: 480 } }}
      content={
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6, maxHeight: 400, overflow: "auto" }}>
          {value}
        </div>
      }
    >
      <Typography.Text type="danger" style={{ fontSize: 12 }}>
        <div
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
            wordBreak: "break-word",
            lineHeight: 1.5,
            cursor: "pointer",
          }}
        >
          {value}
        </div>
      </Typography.Text>
    </Popover>
  );
}

export default function ReviewPage() {
  const { message } = App.useApp();
  const { isNamespaceBusy, startTask, activeTasks } = useTaskContext();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [syncingFeishu, setSyncingFeishu] = useState(false);
  const [accounts, setAccounts] = useState<{ name: string }[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [workTitleFilter, setWorkTitleFilter] = useState<string>("");
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [reviewDateRange, setReviewDateRange] = useState<[Dayjs, Dayjs] | null>(() => [
    dayjs().subtract(7, "day").startOf("day"),
    dayjs().startOf("day"),
  ]);

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

  const doneReviewTaskIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let shouldRefresh = false;
    for (const [id, st] of activeTasks) {
      if (st.namespace === "review" && st.done) {
        if (!doneReviewTaskIdsRef.current.has(id)) {
          doneReviewTaskIdsRef.current.add(id);
          shouldRefresh = true;
        }
      }
    }
    if (shouldRefresh) fetchItems();
  }, [activeTasks, fetchItems]);

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ label: a.name, value: a.name })),
    [accounts]
  );

  const allCreatorAccountNames = useMemo(() => accounts.map((a) => a.name), [accounts]);

  const toolbarAccountSelectOptions = useMemo(
    () => [
      {
        label: accounts.length ? `全部（${accounts.length} 个账号）` : "全部（无账号）",
        value: MULTI_SELECT_ALL_ACCOUNTS,
        disabled: accounts.length === 0,
      },
      ...accountOptions,
    ],
    [accounts.length, accountOptions]
  );

  const toolbarAccountsSanitized = useMemo(
    () => selectedAccounts.filter((n) => allCreatorAccountNames.includes(n)),
    [selectedAccounts, allCreatorAccountNames]
  );

  const toolbarAccountSelectValue = useMemo(() => {
    if (allCreatorAccountNames.length === 0) return [];
    if (
      toolbarAccountsSanitized.length === allCreatorAccountNames.length &&
      allCreatorAccountNames.every((n) => toolbarAccountsSanitized.includes(n))
    ) {
      return [MULTI_SELECT_ALL_ACCOUNTS];
    }
    return toolbarAccountsSanitized;
  }, [allCreatorAccountNames, toolbarAccountsSanitized]);

  function handleToolbarAccountSelectChange(vals: string[]) {
    const picked = [...new Set(vals)];
    if (picked.includes(MULTI_SELECT_ALL_ACCOUNTS)) {
      setSelectedAccounts([...allCreatorAccountNames]);
      return;
    }
    setSelectedAccounts(picked.filter((v) => v !== MULTI_SELECT_ALL_ACCOUNTS));
  }

  const workTitleOptions = useMemo(() => {
    const base = accountFilter === "all" ? items : items.filter((item) => item.accountName === accountFilter);
    const seen = new Set<string>();
    return base
      .map((item) => item.title)
      .filter((t) => {
        if (!t || seen.has(t)) return false;
        seen.add(t);
        return true;
      })
      .map((t) => ({ label: t, value: t }));
  }, [items, accountFilter]);

  const filteredItems = useMemo(() => {
    let result = items;
    if (accountFilter !== "all") {
      result = result.filter((item) => item.accountName === accountFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((item) => item.reviewStatus === statusFilter);
    }
    if (workTitleFilter.trim()) {
      const kw = workTitleFilter.trim().toLowerCase();
      result = result.filter((item) => item.title.toLowerCase().includes(kw));
    }
    return result;
  }, [items, statusFilter, accountFilter, workTitleFilter]);

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

  async function handleFetchWorkInfo() {
    if (selectedAccounts.length === 0) {
      message.warning("请选择至少一个账号");
      return;
    }

    setFetching(true);
    try {
      const body: any = { accounts: selectedAccounts };
      if (reviewDateRange) {
        body.startDate = reviewDateRange[0].format("YYYY-MM-DD");
        body.endDate = reviewDateRange[1].format("YYYY-MM-DD");
      }
      const taskId = await startTask(
        "/api/review/check",
        body,
        "review"
      );
      message.info(`作品信息抓取任务已启动: ${taskId}`);
    } catch (e: any) {
      message.error(e.message || "启动作品信息抓取失败");
    }
    setFetching(false);
  }

  async function handleSyncFeishuLinks() {
    setSyncingFeishu(true);
    try {
      const taskId = await startTask("/api/review/sync-feishu", {}, "review-sync");
      message.info(`同步任务已启动: ${taskId}`);
    } catch (e: any) {
      message.error(e.message || "同步作品链接到飞书失败");
    }
    setSyncingFeishu(false);
  }

  async function handleOpenWorkDetail(item: ReviewItem) {
    if (item.reviewStatus !== "approved" && item.reviewStatus !== "needs_optimization") {
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
        return d.isValid() ? d.format("YYYY-MM-DD HH:mm") : "-";
      },
    },
    {
      title: "审核状态",
      dataIndex: "reviewStatus",
      align: "center" as const,
      width: 70,
      render: (s: ReviewStatus) => {
        const v = REVIEW_STATUS_MAP[s] || { color: "default", text: "未知" };
        return <Tag style={antdTagPresetStyle(v.color)}>{v.text}</Tag>;
      },
    },
    {
      title: "原因",
      dataIndex: "rejectionReason",
      width: 200,
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
      title: "作品链接",
      dataIndex: "workLink",
      align: "center" as const,
      width: 80,
      render: (v: string | undefined) => {
        if (!v) return "-";
        return (
          <TextLink href={v} target="_blank" rel="noopener noreferrer">
            查看
          </TextLink>
        );
      },
    },
    {
      title: "操作",
      align: "center" as const,
      width: 80,
      render: (_: any, r: ReviewItem) => {
        const canOpenDetail = (r.reviewStatus === "approved" || r.reviewStatus === "needs_optimization") && Boolean(r.postId);
        return (
          <Space size={0}>
            <Tooltip title={canOpenDetail ? "用该店铺登录态打开作品详情" : "只有已发布/需优化作品可以打开详情"}>
              <Button
                type="link"
                size="small"
                icon={<LinkOutlined />}
                disabled={!canOpenDetail}
                onClick={() => handleOpenWorkDetail(r)}
                style={{ paddingInline: 4 }}
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

  const underReviewCount = filteredItems.filter((i) => i.reviewStatus === "under_review").length;
  const rejectedCount = filteredItems.filter((i) => i.reviewStatus === "rejected").length;
  const approvedCount = filteredItems.filter((i) => i.reviewStatus === "approved").length;
  const needsOptimizationCount = filteredItems.filter((i) => i.reviewStatus === "needs_optimization").length;

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
            value={toolbarAccountSelectValue}
            onChange={handleToolbarAccountSelectChange}
            options={toolbarAccountSelectOptions}
            loading={loadingAccounts}
            placeholder="选择账号"
            maxTagCount={3}
          />
          <RangePicker
            style={{ width: 260 }}
            value={reviewDateRange}
            onChange={(dates) => setReviewDateRange(dates as [Dayjs, Dayjs] | null)}
            placeholder={["开始日期", "结束日期"]}
            allowClear
            maxDate={dayjs()}
          />
          <Button
            type="primary"
            onClick={handleFetchWorkInfo}
            loading={fetching}
            disabled={isNamespaceBusy("review")}
            icon={<ReloadOutlined />}
          >
            获取作品信息
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
            共 {filteredItems.length} 条
          </Text>
          {approvedCount > 0 && (
            <Tag style={{ ...semanticTagStyle("success"), margin: 0 }}>
              发布 {approvedCount}
            </Tag>
          )}
          {needsOptimizationCount > 0 && (
            <Tag style={{ ...semanticTagStyle("warning"), margin: 0 }}>
              需优化 {needsOptimizationCount}
            </Tag>
          )}
          {underReviewCount > 0 && (
            <Tag style={{ ...semanticTagStyle("processing"), margin: 0 }}>
              审核 {underReviewCount}
            </Tag>
          )}
          {rejectedCount > 0 && (
            <Tag style={{ ...semanticTagStyle("error"), margin: 0 }}>
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
        <Select
          size="small"
          showSearch
          allowClear
          style={{ width: 220 }}
          placeholder="搜索作品名"
          value={workTitleFilter || undefined}
          onChange={(v) => setWorkTitleFilter(v || "")}
          options={workTitleOptions}
        />
        <Button
          type="primary"
          size="small"
          onClick={handleSyncFeishuLinks}
          loading={syncingFeishu}
          icon={<LinkOutlined />}
          style={{ marginLeft: "auto", fontWeight: 500 }}
        >
          同步到飞书
        </Button>
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
        scroll={{ x: 900, y: "calc(100vh - 260px)" }}
        locale={{ emptyText: "暂无作品记录，请先选择账号并点击「获取作品信息」" }}
        style={{ width: "100%" }}
      />
    </div>
  );
}
