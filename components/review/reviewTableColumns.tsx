import { Button, Popover, Space, Tag, Tooltip, Typography } from "antd";
import { DeleteOutlined, LinkOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { ReviewItem, ReviewStatus } from "@/types";
import { antdTagPresetStyle } from "@/lib/semanticTagStyles";
import { REVIEW_STATUS_MAP } from "@/lib/review/constants";
import { RejectionReasonCell } from "@/lib/review/utils";

const { Link: TextLink } = Typography;

export type ReviewTableColumnDeps = {
  onOpenWorkDetail: (item: ReviewItem) => void;
  onDelete: (id: string) => void;
};

export function buildReviewTableColumns({ onOpenWorkDetail, onDelete }: ReviewTableColumnDeps) {
  return [
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
      render: (_: unknown, r: ReviewItem) => {
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
      render: (_: string | undefined, r: ReviewItem) => <RejectionReasonCell item={r} />,
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
      render: (_: unknown, r: ReviewItem) => {
        const canOpenDetail =
          (r.reviewStatus === "approved" || r.reviewStatus === "needs_optimization") &&
          Boolean(r.postId);
        return (
          <Space size={0}>
            <Tooltip
              title={canOpenDetail ? "用该店铺登录态打开作品详情" : "只有已发布/需优化作品可以打开详情"}
            >
              <Button
                type="link"
                size="small"
                icon={<LinkOutlined />}
                disabled={!canOpenDetail}
                onClick={() => onOpenWorkDetail(r)}
                style={{ paddingInline: 4 }}
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
        );
      },
    },
  ];
}
