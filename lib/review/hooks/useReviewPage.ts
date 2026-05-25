import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { buildReviewTableColumns } from "@/components/review/reviewTableColumns";
import { useRefreshOnTaskDone } from "@/hooks/useRefreshOnTaskDone";
import { useToolbarMultiSelect } from "@/hooks/useToolbarMultiSelect";
import { SELECT_ALL_CREATOR_ACCOUNTS } from "@/lib/toolbarMultiSelect";
import { workDetailUrl } from "@/lib/review/utils";
import { useTaskContext } from "@/contexts/TaskContext";
import type { ReviewItem } from "@/types";

export function useReviewPage() {
  const { message } = App.useApp();
  const { isNamespaceBusy, startTask } = useTaskContext();

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [syncingFeishu, setSyncingFeishu] = useState(false);
  const [accounts, setAccounts] = useState<{ name: string }[]>([]);
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
  }, [message]);

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
  }, [message]);

  useEffect(() => {
    fetchAccounts();
    fetchItems();
  }, [fetchAccounts, fetchItems]);

  useRefreshOnTaskDone("review", fetchItems);

  const allCreatorAccountNames = useMemo(() => accounts.map((a) => a.name), [accounts]);

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ label: a.name, value: a.name })),
    [accounts]
  );

  const toolbarMultiSelect = useToolbarMultiSelect({
    allValues: allCreatorAccountNames,
    selectAllToken: SELECT_ALL_CREATOR_ACCOUNTS,
    selectAllLabel: allCreatorAccountNames.length
      ? `全选（${allCreatorAccountNames.length} 个账号）`
      : "全选（无账号）",
    itemOptions: accountOptions,
    defaultSelectAll: false,
  });

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

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/review/delete?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error("删除失败");
        message.success("已删除");
        fetchItems();
      } catch (e: unknown) {
        message.error(e instanceof Error ? e.message : "删除失败");
      }
    },
    [fetchItems, message]
  );

  const handleBatchDelete = useCallback(async () => {
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
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "批量删除失败");
    }
  }, [fetchItems, message, selectedRowKeys]);

  const handleFetchWorkInfo = useCallback(async () => {
    if (toolbarMultiSelect.selected.length === 0) {
      message.warning("请选择至少一个账号");
      return;
    }

    setFetching(true);
    try {
      const body: { accounts: string[]; startDate?: string; endDate?: string } = {
        accounts: toolbarMultiSelect.selected,
      };
      if (reviewDateRange) {
        body.startDate = reviewDateRange[0].format("YYYY-MM-DD");
        body.endDate = reviewDateRange[1].format("YYYY-MM-DD");
      }
      const taskId = await startTask("/api/review/check", body, "review");
      message.info(`作品信息抓取任务已启动: ${taskId}`);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "启动作品信息抓取失败");
    }
    setFetching(false);
  }, [message, reviewDateRange, startTask, toolbarMultiSelect.selected]);

  const handleSyncFeishuLinks = useCallback(async () => {
    setSyncingFeishu(true);
    try {
      const taskId = await startTask("/api/review/sync-feishu", {}, "review-sync");
      message.info(`同步任务已启动: ${taskId}`);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "同步作品链接到飞书失败");
    }
    setSyncingFeishu(false);
  }, [message, startTask]);

  const handleOpenWorkDetail = useCallback(
    async (item: ReviewItem) => {
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
      } catch (e: unknown) {
        message.error(e instanceof Error ? e.message : "打开作品详情失败");
      }
    },
    [message, startTask]
  );

  const columns = useMemo(
    () =>
      buildReviewTableColumns({
        onOpenWorkDetail: handleOpenWorkDetail,
        onDelete: handleDelete,
      }),
    [handleDelete, handleOpenWorkDetail]
  );

  const underReviewCount = filteredItems.filter((i) => i.reviewStatus === "under_review").length;
  const rejectedCount = filteredItems.filter((i) => i.reviewStatus === "rejected").length;
  const approvedCount = filteredItems.filter((i) => i.reviewStatus === "approved").length;
  const needsOptimizationCount = filteredItems.filter(
    (i) => i.reviewStatus === "needs_optimization"
  ).length;

  return {
    columns,
    filteredItems,
    loadingItems,
    loadingAccounts,
    fetching,
    syncingFeishu,
    reviewBusy: isNamespaceBusy("review"),
    statusFilter,
    setStatusFilter,
    accountFilter,
    setAccountFilter,
    workTitleFilter,
    setWorkTitleFilter,
    accountOptions,
    workTitleOptions,
    selectedRowKeys,
    setSelectedRowKeys,
    reviewDateRange,
    setReviewDateRange,
    toolbarAccountsSanitized: toolbarMultiSelect.sanitized,
    toolbarAccountSelectOptions: toolbarMultiSelect.selectOptions,
    handleToolbarAccountSelectChange: toolbarMultiSelect.handleChange,
    handleFetchWorkInfo,
    handleBatchDelete,
    handleSyncFeishuLinks,
    underReviewCount,
    rejectedCount,
    approvedCount,
    needsOptimizationCount,
  };
}
