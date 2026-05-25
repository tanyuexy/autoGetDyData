import { Popover, Typography } from "antd";
import type { ReviewItem } from "@/types";

export function workDetailUrl(postId: string) {
  return `https://creator.douyin.com/creator-micro/work-management/work-detail/${encodeURIComponent(
    postId
  )}?enter_from=content`;
}

export function isReviewScreenshotPath(value?: string) {
  return Boolean(value && /storage\/creator-accounts\/.+\.png$/i.test(value));
}

export function screenshotUrl(value: string) {
  return `/api/review/screenshot?path=${encodeURIComponent(value)}`;
}

export function RejectionReasonCell({ item }: { item: ReviewItem }) {
  const value = item.rejectionScreenshotPath || item.rejectionReason;
  if (!value) return <>-</>;

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
