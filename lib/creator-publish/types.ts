export type TaskType = "video" | "article";

export type TaskStatus = "pending" | "queued" | "running" | "success" | "failed" | "cancelled";

export type TaskPayload =
  | {
      type: "video";
      videoFileKey: string;
      title?: string;
      description?: string;
      scheduleAt?: string | null;
      productTitle?: string;
      approvalNumber?: string;
      isAiContent?: boolean;
      productLink?: string;
      publishEnabled?: boolean;
      publishWaitSec?: number;
    }
  | {
      type: "article";
      imagesFileKeys: string[];
      title?: string;
      description?: string;
      scheduleAt?: string | null;
      coverImageKey?: string;
      productLink?: string;
      productTitle?: string;
      approvalNumber?: string;
      isAiContent?: boolean;
      publishEnabled?: boolean;
      publishWaitSec?: number;
    };

export type PublishTask = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** 表格可见字段最后变更时间，见 lib/creatorPublishStore#patchTouchesTaskTable */
  displayUpdatedAt?: string;
  accountName: string;
  status: TaskStatus;
  payload: TaskPayload;
  lastError?: string;
  taskId?: string;
  feishuRowNumber?: number;
};

export type EditTaskState = {
  id: string;
  /** 店铺/抖创账号，与 task.accountName 一致 */
  accountName: string;
  title: string;
  description: string;
  productLink: string;
  productTitle: string;
  approvalNumber: string;
  isAiContent: boolean;
  scheduleAt: string | null;
} | null;
