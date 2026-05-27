import { callMiniMaxStructured } from "@/lib/llm/minimax";
import type { JsonSchemaObject } from "@/lib/llm/types";

const DEFAULT_MODEL = process.env.MINIMAX_MODEL?.trim() || "MiniMax-M2.7";
export const MAX_CLIP_NAME_LENGTH = 24;
const PROMPT_SNIPPET_MAX_CHARS = 1200;

const NAME_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: {
      type: "string",
      description: "用于列表展示的简短中文片名，不超过24字",
      maxLength: MAX_CLIP_NAME_LENGTH,
    },
  },
};

export function fallbackClipName(prompt: string): string {
  const trimmed = prompt.trim();
  return trimmed.slice(0, MAX_CLIP_NAME_LENGTH) || "未命名片段";
}

export function sanitizeClipName(value: string): string {
  return value
    .replace(/[<>"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CLIP_NAME_LENGTH);
}

export async function generateClipNameFromPrompt(prompt: string): Promise<string | null> {
  const trimmed = prompt.trim();
  if (!trimmed) return null;

  const result = await callMiniMaxStructured({
    model: DEFAULT_MODEL,
    schemaName: "ai_video_clip_name",
    schema: NAME_SCHEMA,
    temperature: 0.35,
    maxTokens: 128,
    messages: [
      {
        role: "system",
        content: [
          "你是短视频素材命名助手。",
          "根据用户的视频生成提示词，输出一条简短中文片名，用于后台列表展示。",
          "要求：概括画面主旨；不要标点、引号、emoji；不要「版本一」等套话；不超过24字。",
          '只输出 JSON：{"name":"片名"}',
        ].join("\n"),
      },
      {
        role: "user",
        content: `提示词如下，请生成片名：\n\n${trimmed.slice(0, PROMPT_SNIPPET_MAX_CHARS)}`,
      },
    ],
  });

  const parsed =
    result.data && typeof result.data === "object"
      ? (result.data as { name?: unknown })
      : null;
  const fromSchema = sanitizeClipName(String(parsed?.name || ""));
  if (fromSchema) return fromSchema;

  const loose = result.rawContent.match(/"name"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (loose?.[1]) {
    const decoded = loose[1].replace(/\\"/g, '"');
    const fromLoose = sanitizeClipName(decoded);
    if (fromLoose) return fromLoose;
  }

  return null;
}

export function getClipNameModelName() {
  return DEFAULT_MODEL;
}
