import { Button, Popover, Space, Tag, Tooltip } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import type { CommentItem } from "@/types";
import { semanticTagStyle } from "@/lib/semanticTagStyles";

export type CommentTableColumnDeps = {
  onOpenReply: (item: CommentItem) => void;
  onDelete: (id: string) => void;
};

export function buildCommentTableColumns({ onOpenReply, onDelete }: CommentTableColumnDeps) {
  return [
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
      render: (_: unknown, r: CommentItem) => (
        <Space size={0}>
          <Tooltip title="以店铺身份回复">
            <Button
              type="text"
              size="small"
              icon={<span style={{ fontSize: 12, color: "#1677ff" }}>回</span>}
              onClick={() => onOpenReply(r)}
            />
          </Tooltip>
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => onDelete(r.id)}
          />
        </Space>
      ),
    },
  ];
}
