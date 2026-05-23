"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Button,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Popover,
  InputNumber,
  Tooltip,
} from "antd";
import { ReloadOutlined, DeleteOutlined } from "@ant-design/icons";
import { useTaskContext } from "@/contexts/TaskContext";
import { semanticTagStyle } from "@/lib/semanticTagStyles";
import type { CommentItem } from "@/types";

const { Text } = Typography;

/** 工具栏账号多选的「一键全选」，不会作为真实账号名传给接口 */
const MULTI_SELECT_ALL_ACCOUNTS = "__toolbar_all_creator_accounts__";

export default function CommentPage() {
  const { message } = App.useApp();
  const { isNamespaceBusy, startTask, activeTasks } = useTaskContext();
  const [items, setItems] = useState<CommentItem[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [accounts, setAccounts] = useState<{ name: string }[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [maxWorks, setMaxWorks] = useState(10);
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [workTitleFilter, setWorkTitleFilter] = useState("");
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [replyModalOpen, setReplyModalOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<{ awemeId: string; accountName: string; workTitle: string; cid?: string; userName?: string; commentText?: string } | null>(null);
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
  }, []);

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
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchItems();
  }, [fetchAccounts, fetchItems]);

  const doneCommentTaskIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let shouldRefresh = false;
    for (const [id, st] of activeTasks) {
      if (st.namespace === "comment" && st.done) {
        if (!doneCommentTaskIdsRef.current.has(id)) {
          doneCommentTaskIdsRef.current.add(id);
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
        label: accounts.length ? `全选（${accounts.length} 个账号）` : "全选（无账号）",
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

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/comment/delete?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
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
    } catch (e: any) {
      message.error(e.message || "批量删除失败");
    }
  }

  async function handleFetchComments() {
    if (selectedAccounts.length === 0) {
      message.warning("请选择至少一个账号");
      return;
    }

    setFetching(true);
    try {
      const taskId = await startTask(
        "/api/comment/fetch",
        { accounts: selectedAccounts, maxWorks },
        "comment"
      );
      message.info(`评论抓取任务已启动: ${taskId}`);
    } catch (e: any) {
      message.error(e.message || "启动评论抓取失败");
    }
    setFetching(false);
  }

  function handleOpenReply(r: CommentItem) {
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
  }

  async function handleSubmitReply() {
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
    } catch (e: any) {
      message.error(e.message || "回复失败");
    }
    setReplySending(false);
  }

  const columns = [
    {
      title: "账号",
      dataIndex: "accountName",
      align: "center" as const,
      width: 90,
      render: (v: string) => (
        <div
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
            wordBreak: "break-word",
            lineHeight: 1.5,
            fontSize: 12,
          }}
        >
          {v}
        </div>
      ),
    },
    {
      title: "作品标题",
      dataIndex: "workTitle",
      width: 180,
      render: (v: string) => {
        if (!v) return "-";
        return (
          <Popover
            trigger="hover"
            placement="topLeft"
            styles={{ root: { maxWidth: 420 } }}
            content={
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}>
                {v}
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
                fontSize: 12,
              }}
            >
              {v}
            </div>
          </Popover>
        );
      },
    },
    {
      title: "评论内容",
      dataIndex: "text",
      width: 220,
      render: (v: string) => {
        if (!v) return "-";
        return (
          <Popover
            trigger="hover"
            placement="topLeft"
            styles={{ root: { maxWidth: 480 } }}
            content={
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}>
                {v}
              </div>
            }
          >
            <div
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 3,
                overflow: "hidden",
                wordBreak: "break-word",
                lineHeight: 1.5,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {v}
            </div>
          </Popover>
        );
      },
    },
    {
      title: "用户",
      dataIndex: "user",
      align: "center" as const,
      width: 90,
      render: (v: string) => (
        <div style={{ fontSize: 12, wordBreak: "break-word" }}>{v || "-"}</div>
      ),
    },
    {
      title: "点赞",
      dataIndex: "likeCount",
      align: "center" as const,
      width: 50,
      render: (v: number) => v || 0,
    },
    {
      title: "回复",
      dataIndex: "replyCount",
      align: "center" as const,
      width: 50,
      render: (v: number) => v || 0,
    },
    {
      title: "评论时间",
      dataIndex: "createTime",
      align: "center" as const,
      width: 100,
      render: (v: string) => {
        if (!v) return "-";
        try {
          const d = new Date(v);
          const pad = (n: number) => String(n).padStart(2, "0");
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch {
          return v;
        }
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      align: "center" as const,
      width: 60,
      render: (s: number) => {
        if (s === 1) return <Tag style={semanticTagStyle("success")}>正常</Tag>;
        if (s === 3) return <Tag style={semanticTagStyle("warning")}>屏蔽</Tag>;
        return <Tag style={semanticTagStyle("default")}>{s}</Tag>;
      },
    },
    {
      title: "操作",
      align: "center" as const,
      width: 80,
      render: (_: any, r: CommentItem) => (
        <Space size={0}>
          <Tooltip title="以店铺身份回复">
            <Button
              type="text"
              size="small"
              icon={<span style={{ fontSize: 12, color: "#1677ff" }}>回</span>}
              onClick={() => handleOpenReply(r)}
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
      ),
    },
  ];

  const totalComments = items.length;
  const accountStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      map.set(item.accountName, (map.get(item.accountName) || 0) + 1);
    }
    return map;
  }, [items]);

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          marginBottom: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Space size={12} wrap align="center">
          <Select
            mode="multiple"
            allowClear
            size="middle"
            style={{ minWidth: 240 }}
            value={toolbarAccountsSanitized}
            onChange={handleToolbarAccountSelectChange}
            options={toolbarAccountSelectOptions}
            loading={loadingAccounts}
            placeholder="选择账号"
            maxTagCount={3}
          />
          <Tooltip title="每个账号抓取的作品数">
            <span style={{ display: "inline-flex", verticalAlign: "middle" }}>
              <Space.Compact>
                <Button type="default" disabled tabIndex={-1} size="middle">
                  前
                </Button>
                <InputNumber
                  min={1}
                  max={50}
                  size="middle"
                  value={maxWorks}
                  onChange={(v) => setMaxWorks(v ?? 10)}
                  controls={false}
                  style={{ width: 56 }}
                />
                <Button type="default" disabled tabIndex={-1} size="middle">
                  个
                </Button>
              </Space.Compact>
            </span>
          </Tooltip>
          <Button
            type="primary"
            size="middle"
            onClick={handleFetchComments}
            loading={fetching}
            disabled={isNamespaceBusy("comment")}
            icon={<ReloadOutlined />}
          >
            抓取评论
          </Button>
        </Space>

        <Space size={8} wrap>
          {selectedRowKeys.length > 0 && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={handleBatchDelete}
            >
              批量删除 ({selectedRowKeys.length})
            </Button>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {totalComments} 条评论
          </Text>
          {Array.from(accountStats.entries()).map(([name, count]) => (
            <Tag key={name} style={{ margin: 0, fontSize: 11, ...semanticTagStyle("default") }}>
              {name.length > 20 ? name.slice(0, 8) + "..." : name}: {count}
            </Tag>
          ))}
        </Space>
      </div>

      <div style={{ marginBottom: 10, display: "flex", gap: 12, alignItems: "center" }}>
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
        pagination={{
          pageSize: 30,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条评论`,
        }}
        scroll={{ x: 960, y: "calc(100vh - 260px)" }}
        locale={{ emptyText: "暂无评论数据，请先选择账号并点击「抓取评论」" }}
        style={{ width: "100%" }}
      />

      <Modal
        title="店铺回复"
        open={replyModalOpen}
        onCancel={() => setReplyModalOpen(false)}
        destroyOnHidden
        footer={
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              {replyText.length} / 500
            </Text>
            <Space>
              <Button onClick={() => setReplyModalOpen(false)}>取消</Button>
              <Button type="primary" loading={replySending} onClick={handleSubmitReply}>
                发送回复
              </Button>
            </Space>
          </div>
        }
      >
        {replyTarget && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4, color: "rgba(0,0,0,0.45)", fontSize: 12 }}>
              账号：{replyTarget.accountName}
            </div>
            <div style={{ color: "rgba(0,0,0,0.45)", fontSize: 12, lineHeight: 1.4 }}>
              作品：{replyTarget.workTitle}
            </div>
          </div>
        )}
        {replyTarget && (
          <div style={{ marginBottom: 12 }}>
            <Radio.Group value={replyMode} onChange={(e) => setReplyMode(e.target.value)}>
              <Radio value="comment">店铺评论</Radio>
              <Radio value="reply">店铺回复用户</Radio>
            </Radio.Group>
          </div>
        )}
        {replyMode === "reply" && replyTarget?.cid && (
          <div
            style={{
              marginBottom: 12,
              padding: 8,
              background: "#f5f5f5",
              borderRadius: 4,
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            <div style={{ color: "rgba(0,0,0,0.45)", marginBottom: 4 }}>
              回复用户：<strong>{replyTarget.userName || "未知用户"}</strong>
            </div>
            <div style={{ color: "rgba(0,0,0,0.65)" }}>
              {replyTarget.commentText || ""}
            </div>
          </div>
        )}
        <Input.TextArea
          rows={4}
          maxLength={500}
          placeholder={replyMode === "reply" ? "输入回复内容..." : "输入评论内容..."}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
        />
      </Modal>
    </div>
  );
}
