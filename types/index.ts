export interface CreatorAccount {
  name: string;
  hasStorageState: boolean;
  hasCookies: boolean;
  hasExportDateConfig: boolean;
  exportDateStart: string | null;
  cookieStatus?: "valid" | "warning" | "expired" | "missing";
  cookieDetail?: string | null;
  lastLoginAt?: string | null;
  lastVerifiedAt?: string | null;
}

export interface ShopAccount {
  email: string;
  password: string;
  hasStorageState: boolean;
  cookieStatus?: "valid" | "warning" | "expired" | "missing";
  cookieDetail?: string | null;
  lastLoginAt?: string | null;
  lastVerifiedAt?: string | null;
}

export interface FeishuTokenStatus {
  valid: boolean;
  expiresAt: string | null;
  hasToken: boolean;
}

export interface ConfigData {
  accounts: string[];
  emails: { email: string; password: string }[];
  creatorExportDateStart: string | null;
  creatorExportDateStartByAccount: Record<string, string>;
  douyinCreator: { loginVerifyMethod: string };
  headless: boolean;
  creatorPublish?: {
    publishEnabled?: boolean; // 是否点击发布按钮（默认 true）
    publishWaitSec?: number;  // 发布后停留秒数（默认 3）
    automation?: {
      enabled?: boolean;
      mode?: "weekly" | "interval";
      weekly?: {
        days?: number[]; // 0=周日, 1=周一 ... 6=周六
        times?: string[]; // HH:mm
      };
      interval?: {
        days?: number[]; // 0=周日, 1=周一 ... 6=周六
        everyMinutes?: number;
        anchorAt?: string | null; // ISO string
      };
    };
  };
  feishu: {
    shop: { baseUrl?: string; appToken: string; tableId: string };
    creator: { baseUrl?: string; appToken: string; tableId: string; keepRows?: number };
    task: { baseUrl?: string; appToken: string; tableId: string };
    product: { baseUrl?: string; appToken: string; tableId: string };
  };
}

export interface LogEntry {
  text: string;
  level: "info" | "warn" | "error";
  timestamp: string;
}

export interface TaskProgress {
  current: number;
  total: number;
  label: string;
}

export interface SSEDoneEvent {
  code: number;
  summary: string;
}

export interface RunningTaskInfo {
  taskId: string;
  namespace: string;
  startedAt: number;
}

export type ReviewStatus = "under_review" | "approved" | "rejected";

export interface ReviewItem {
  id: string;
  accountName: string;
  postId: string;
  title: string;
  coverUrl?: string;
  publishDate: string;
  reviewStatus: ReviewStatus;
  rejectionReason?: string;
  rejectionScreenshotPath?: string;
  checkedAt: string;
  createdAt: string;
  updatedAt: string;
}
