import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "antd";
import { buildCommentTableColumns } from "@/components/comment/commentTableColumns";
import type { CommentReplyTarget } from "@/components/comment/CommentReplyModal";
import { useRefreshOnTaskDone } from "@/hooks/useRefreshOnTaskDone";
import { useToolbarMultiSelect } from "@/hooks/useToolbarMultiSelect";
import { SELECT_ALL_CREATOR_ACCOUNTS } from "@/lib/toolbarMultiSelect";
import { useTaskContext } from "@/contexts/TaskContext";
import type { CommentItem } from "@/types";

export function useCommentPage() {
  const { message } = App.useApp();
  const { isNamespaceBusy, startTask } = useTaskContext();

  const [items, setItems] = useState<CommentItem[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [accounts, setAccounts] = useState<{ name: string }[]>([]);
  const [maxWorks, setMaxWorks] = useState(10);
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [workTitleFilter, setWorkTitleFilter] = useState("");
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [replyModalOpen, setReplyModalOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<CommentReplyTarget | null>(null);
  const [replyMode, setReplyMode] = useState<"comment" | "reply">("comment");
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);

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
      const res = await fetch("/api/comment/list");
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      message.error("获取评论记录失败");
    }
    setLoadingItems(false);
  }, [message]);

  useEffect(() => {
    fetchAccounts();
    fetchItems();
  }, [fetchAccounts, fetchItems]);

  useRefreshOnTaskDone("comment", fetchItems);

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
      .map((item) => item.workTitle)
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
    if (workTitleFilter.trim()) {
      const kw = workTitleFilter.trim().toLowerCase();
      result = result.filter((item) => item.workTitle.toLowerCase().includes(kw));
    }
    return result;
  }, [items, accountFilter, workTitleFilter]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/comment/delete?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
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
      const res = await fetch("/api/comment/delete", {
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

  const handleFetchComments = useCallback(async () => {
    if (toolbarMultiSelect.selected.length === 0) {
      message.warning("请选择至少一个账号");
      return;
    }

    setFetching(true);
    try {
      const taskId = await startTask(
        "/api/comment/fetch",
        { accounts: toolbarMultiSelect.selected, maxWorks },
        "comment"
      );
      message.info(`评论抓取任务已启动: ${taskId}`);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "启动评论抓取失败");
    }
    setFetching(false);
  }, [maxWorks, message, startTask, toolbarMultiSelect.selected]);

  const handleOpenReply = useCallback((r: CommentItem) => {
    setReplyTarget({
      awemeId: r.awemeId,
      accountName: r.accountName,
      workTitle: r.workTitle,
      cid: r.cid,
      userName: r.user,
      commentText: r.text,
    });
    setReplyMode("comment");
    setReplyText("");
    setReplyModalOpen(true);
  }, []);

  const handleSubmitReply = useCallback(async () => {
    if (!replyTarget || !replyText.trim()) return;
    setReplySending(true);
    try {
      const body: Record<string, string> = {
        accountName: replyTarget.accountName,
        awemeId: replyTarget.awemeId,
        text: replyText.trim(),
      };
      if (replyMode === "reply" && replyTarget.cid) {
        body.replyToCid = replyTarget.cid;
      }
      const taskId = await startTask("/api/comment/reply", body, "comment");
      message.info(`回复任务已启动: ${taskId}`);
      setReplyModalOpen(false);
      setReplyText("");
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "回复失败");
    }
    setReplySending(false);
  }, [message, replyMode, replyTarget, replyText, startTask]);

  const columns = useMemo(
    () =>
      buildCommentTableColumns({
        onOpenReply: handleOpenReply,
        onDelete: handleDelete,
      }),
    [handleDelete, handleOpenReply]
  );

  const accountStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      map.set(item.accountName, (map.get(item.accountName) || 0) + 1);
    }
    return map;
  }, [items]);

  return {
    columns,
    filteredItems,
    loadingItems,
    loadingAccounts,
    fetching,
    commentBusy: isNamespaceBusy("comment"),
    maxWorks,
    setMaxWorks,
    accountFilter,
    setAccountFilter,
    workTitleFilter,
    setWorkTitleFilter,
    accountOptions,
    workTitleOptions,
    selectedRowKeys,
    setSelectedRowKeys,
    toolbarAccountsSanitized: toolbarMultiSelect.sanitized,
    toolbarAccountSelectOptions: toolbarMultiSelect.selectOptions,
    handleToolbarAccountSelectChange: toolbarMultiSelect.handleChange,
    handleFetchComments,
    handleBatchDelete,
    totalComments: items.length,
    accountStats,
    replyModalOpen,
    setReplyModalOpen,
    replyTarget,
    replyMode,
    setReplyMode,
    replyText,
    setReplyText,
    replySending,
    handleSubmitReply,
  };
}
