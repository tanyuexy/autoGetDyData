import type { ReviewStatus } from "@/types";

export const REVIEW_STATUS_MAP: Record<ReviewStatus, { color: string; text: string }> = {
  under_review: { color: "processing", text: "审核中" },
  approved: { color: "success", text: "已发布" },
  rejected: { color: "error", text: "未通过" },
  needs_optimization: { color: "warning", text: "需优化" },
};

export const STATUS_FILTER_OPTIONS = [
  { label: "全部", value: "all" },
  { label: "已发布", value: "approved" },
  { label: "审核中", value: "under_review" },
  { label: "需优化", value: "needs_optimization" },
  { label: "未通过", value: "rejected" },
];
