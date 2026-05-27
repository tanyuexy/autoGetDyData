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

/** 列表展示用：无效/占位片名时回退为提示词前 24 字 */
export function resolveClipDisplayName(name: string, prompt: string): string {
  const valid = sanitizeClipName(name);
  if (valid) return valid;
  return fallbackClipName(prompt);
}

const PLACEHOLDER_CLIP_NAMES = new Set([
  "片名",
  "标题",
  "名称",
  "视频名",
  "片段名",
  "视频标题",
  "短片名",
  "未命名片段",
  "未命名",
]);

function isPlaceholderClipName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_CLIP_NAMES.has(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  return lower === "name" || lower === "title";
}

export function sanitizeClipName(value: string): string | null {
  const cleaned = value
    .replace(/[<>"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CLIP_NAME_LENGTH);
  if (!cleaned || isPlaceholderClipName(cleaned)) return null;
  return cleaned;
}

export async function generateClipNameFromPrompt(prompt: string): Promise<string | null> {
  const trimmed = prompt.trim();
  if (!trimmed) return null;

  const result = await callMiniMaxStructured({
    model: DEFAULT_MODEL,
    schemaName: "ai_video_clip_name",
    schema: NAME_SCHEMA,
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content: [
          "你是短视频素材命名助手。",
          "根据用户的视频生成提示词，直接输出一条简短中文片名，用于后台列表展示。",
          "要求：概括画面主旨与产品/场景；不要标点、引号、emoji；不要「版本一」等套话；",
          "禁止输出占位词（片名、标题、名称等），必须写具体内容；不超过24字。",
          "不要解释、不要分析过程、不要 Markdown。",
          '只输出 JSON，示例：{"name":"竖屏氨糖产品种草"}',
        ].join("\n"),
      },
      {
        role: "user",
        content: `根据以下视频提示词生成一条具体片名（不要返回「片名」二字）：\n\n${trimmed.slice(0, PROMPT_SNIPPET_MAX_CHARS)}`,
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
