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

export type FeishuAiProvider = "siliconflow" | "deepseek" | "minimax";

export interface ConfigData {
  accounts: string[];
  emails: { email: string; password: string }[];
  creatorExportDateStart: string | null;
  creatorExportDateStartByAccount: Record<string, string>;
  headless: boolean;
  creatorPublish?: {
    publishEnabled?: boolean; // 是否点击发布按钮（默认 true）
    publishWaitSec?: number;  // 发布后停留秒数（默认 3）
    /** API + Worker 可同时运行的发布浏览器进程上限（默认 3，范围 1–20） */
    publishMaxConcurrent?: number;
    /** 飞书 AI 生成正文使用的 LLM 厂商（「AI生成正文」按钮） */
    feishuAiProvider?: FeishuAiProvider;
    /** 飞书 AI 正文生成并发数（默认 3，范围 1–10） */
    feishuAiContentMaxConcurrent?: number;
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
    shop: { baseUrl?: string; appToken: string; tableId: string; keepRows?: number };
    creator: { baseUrl?: string; appToken: string; tableId: string; keepRows?: number };
    task: { baseUrl?: string; appToken: string; tableId: string };
    product: { baseUrl?: string; appToken: string; tableId: string };
    shopInfo: { baseUrl?: string; appToken: string; tableId: string };
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

export type ReviewStatus = "under_review" | "approved" | "rejected" | "needs_optimization";

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
  workLink?: string;
  workType?: string;
  checkedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentItem {
  id: string;
  accountName: string;
  awemeId: string;
  cid: string;
  text: string;
  user: string;
  userId: string;
  likeCount: number;
  replyCount: number;
  createTime: string;
  status: number;
  workTitle: string;
  workCreateTime: string;
  fetchedAt: string;
}


export type AiVideoGenerationMode = "text" | "first-frame" | "first-last-frame";

export interface AiVideoUploadFileSnapshot {
  uid: string;
  name?: string;
  status?: string;
  url?: string;
  thumbUrl?: string;
}

export interface AiVideoReferenceResource {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
  url: string;
  size?: number;
}

export interface AiVideoClipFormSnapshot {
  model: string;
  mode: AiVideoGenerationMode;
  prompt: string;
  firstFrameUrl: string;
  lastFrameUrl: string;
  firstFrameFiles: AiVideoUploadFileSnapshot[];
  lastFrameFiles: AiVideoUploadFileSnapshot[];
  referenceResources: AiVideoReferenceResource[];
  ratio: string;
  resolution: string;
  duration: number;
  generateAudio: boolean;
  watermark: boolean;
  seed: number | null;
  callbackUrl: string;
}


export interface AiVideoComposedFilmSegment {
  id: string;
  name: string;
  order: number;
}

export interface AiVideoComposedFilm {
  id: string;
  videoUrl: string;
  mode: "sequential" | "random";
  segments: AiVideoComposedFilmSegment[];
  backgroundMusic?: string | null;
  comboIndex?: number | null;
  createdAt: string;
}

export interface AiVideoClip {
  id: string;
  name: string;
  model: string;
  prompt: string;
  mode: AiVideoGenerationMode;
  status: string;
  taskId?: string;
  videoUrl?: string | null;
  remoteVideoUrl?: string | null;
  coverUrl?: string | null;
  duration: number;
  ratio: string;
  resolution: string;
  /** 混剪分组名，随机混剪时同组片段互斥选取 */
  composeGroup?: string | null;
  /** 片段标签，用于列表筛选与随机混剪按标签选分组 */
  tag?: string | null;
  createdAt: string;
  updatedAt: string;
  formSnapshot?: AiVideoClipFormSnapshot;
}
