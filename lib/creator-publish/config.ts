import type { ConfigData } from "@/types";
import {
  FEISHU_AI_CONTENT_MAX_CONCURRENT_DEFAULT,
  normalizeFeishuAiContentMaxConcurrent,
} from "@/lib/feishu/aiContentConcurrency";
import { normalizeFeishuAiProvider } from "@/lib/feishu/aiProvider";
import {
  PUBLISH_MAX_CONCURRENT_DEFAULT,
  normalizePublishMaxConcurrent,
} from "@/lib/creator-publish/publishConcurrency";

export type CreatorPublishConfig = NonNullable<ConfigData["creatorPublish"]>;

export const DEFAULT_CREATOR_PUBLISH_CONFIG: CreatorPublishConfig = {
  publishEnabled: true,
  publishWaitSec: 3,
  publishMaxConcurrent: PUBLISH_MAX_CONCURRENT_DEFAULT,
  feishuAiProvider: "minimax",
  feishuAiContentMaxConcurrent: FEISHU_AI_CONTENT_MAX_CONCURRENT_DEFAULT,
  automation: {
    enabled: false,
    mode: "weekly",
    weekly: {
      days: [1, 2, 3, 4, 5],
      times: ["09:00"],
    },
    interval: {
      days: [1, 2, 3, 4, 5],
      everyMinutes: 60,
      anchorAt: null,
    },
  },
};

export const WEEKDAY_OPTIONS = [
  { label: "周一", value: 1 },
  { label: "周二", value: 2 },
  { label: "周三", value: 3 },
  { label: "周四", value: 4 },
  { label: "周五", value: 5 },
  { label: "周六", value: 6 },
  { label: "周日", value: 0 },
];

export function normalizeTimeTags(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter((item) => /^\d{2}:\d{2}$/.test(item))
    )
  ).sort();
}

export function normalizeCreatorPublishConfig(
  input?: Partial<CreatorPublishConfig> | null
): CreatorPublishConfig {
  return {
    publishEnabled: input?.publishEnabled ?? DEFAULT_CREATOR_PUBLISH_CONFIG.publishEnabled,
    publishWaitSec: input?.publishWaitSec ?? DEFAULT_CREATOR_PUBLISH_CONFIG.publishWaitSec,
    publishMaxConcurrent: normalizePublishMaxConcurrent(
      input?.publishMaxConcurrent ?? DEFAULT_CREATOR_PUBLISH_CONFIG.publishMaxConcurrent
    ),
    feishuAiProvider: normalizeFeishuAiProvider(
      input?.feishuAiProvider ?? DEFAULT_CREATOR_PUBLISH_CONFIG.feishuAiProvider
    ),
    feishuAiContentMaxConcurrent: normalizeFeishuAiContentMaxConcurrent(
      input?.feishuAiContentMaxConcurrent ??
        DEFAULT_CREATOR_PUBLISH_CONFIG.feishuAiContentMaxConcurrent
    ),
    automation: {
      enabled: input?.automation?.enabled ?? DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.enabled,
      mode: input?.automation?.mode ?? DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.mode,
      weekly: {
        days: input?.automation?.weekly?.days ?? DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.weekly!.days,
        times: normalizeTimeTags(
          input?.automation?.weekly?.times ?? DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.weekly!.times!
        ),
      },
      interval: {
        days: input?.automation?.interval?.days ?? DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.interval!.days,
        everyMinutes:
          input?.automation?.interval?.everyMinutes ??
          DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.interval!.everyMinutes,
        anchorAt:
          input?.automation?.interval?.anchorAt ??
          DEFAULT_CREATOR_PUBLISH_CONFIG.automation!.interval!.anchorAt,
      },
    },
  };
}

export function getAutomationSelectedDays(config: CreatorPublishConfig): number[] {
  const mode = config.automation?.mode ?? "weekly";
  return mode === "interval"
    ? config.automation?.interval?.days ?? []
    : config.automation?.weekly?.days ?? [];
}
