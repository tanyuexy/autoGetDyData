import { readFile } from "fs/promises";
import path from "path";
import { callMiniMaxStructured } from "@/lib/llm/minimax";
import { parseStructuredContent } from "@/lib/llm/shared";
import type { JsonSchemaObject } from "@/lib/llm/types";
import type { GenerationMode } from "./types";
import { normalizePromptWhitespace } from "@/lib/ai-video/promptFormat";

const SKILL_PATH = path.join(process.cwd(), "docs/seedance-prompt-skill.md");
const DEFAULT_MODEL = process.env.MINIMAX_MODEL?.trim() || "MiniMax-M2.7";
const MAX_PROMPT_CHARS = 1800;

export interface SeedancePromptReferenceInput {
  kind: "image" | "video" | "audio";
  name: string;
  token: string;
}

export interface GenerateSeedancePromptInput {
  brief: string;
  mode: GenerationMode;
  model: string;
  duration: number;
  ratio: string;
  resolution: string;
  generateAudio: boolean;
  referenceResources: SeedancePromptReferenceInput[];
  hasFirstFrame?: boolean;
  hasLastFrame?: boolean;
  stylePreference?: string;
  existingPrompt?: string;
}

export interface SeedancePromptVersion {
  title: string;
  prompt: string;
  note?: string;
}

export interface GenerateSeedancePromptResult {
  versions: SeedancePromptVersion[];
  model: string;
}

const PROMPT_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["versions"],
  properties: {
    versions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "prompt"],
        properties: {
          title: { type: "string", description: "版本标题，简短概括风格差异" },
          prompt: {
            type: "string",
            description: "可直接粘贴到即梦 Seedance 2.0 的中文视频提示词，不超过 1800 字",
            maxLength: MAX_PROMPT_CHARS,
          },
          note: { type: "string", description: "可选，一句话说明该版本的设计意图" },
        },
      },
    },
  },
};

let cachedSkillBody: string | null = null;

function stripSkillFrontmatter(content: string) {
  if (!content.startsWith("---")) return content.trim();
  const end = content.indexOf("---", 3);
  if (end === -1) return content.trim();
  return content.slice(end + 3).trim();
}

export async function loadSeedancePromptSkillBody() {
  if (cachedSkillBody) return cachedSkillBody;
  const raw = await readFile(SKILL_PATH, "utf8");
  cachedSkillBody = stripSkillFrontmatter(raw);
  return cachedSkillBody;
}

function modeLabel(mode: GenerationMode) {
  if (mode === "text") return "文生视频";
  if (mode === "first-last-frame") return "首尾帧生视频";
  if (mode === "multimodal-reference") return "多模态参考生视频";
  return "首帧生视频";
}

function buildReferenceSummary(resources: SeedancePromptReferenceInput[]) {
  if (!resources.length) return "无参考素材（纯文本模式）";
  return resources
    .map(
      (item) =>
        `- @${item.token}（${item.kind === "image" ? "图片" : item.kind === "video" ? "视频" : "音频"}：${item.name}）`
    )
    .join("\n");
}

function buildUserMessage(input: GenerateSeedancePromptInput) {
  const lines = [
    "请根据以下信息生成 Seedance 2.0 视频提示词。",
    "",
    "## 创意简述",
    input.brief.trim(),
    "",
    "## 当前表单参数（已确定，不要再向用户提问）",
    `- 生成模式：${modeLabel(input.mode)}`,
    `- Seedance 模型：${input.model}`,
    `- 视频时长：${input.duration} 秒`,
    `- 画面比例：${input.ratio}`,
    `- 分辨率：${input.resolution}`,
    `- 生成声音：${input.generateAudio ? "是" : "否"}`,
    `- 已上传首帧：${input.hasFirstFrame ? "是" : "否"}`,
    `- 已上传尾帧：${input.hasLastFrame ? "是" : "否"}`,
    "",
    "## 参考素材",
    buildReferenceSummary(input.referenceResources),
  ];

  if (input.stylePreference?.trim()) {
    lines.push("", "## 风格/氛围偏好", input.stylePreference.trim());
  }
  if (input.existingPrompt?.trim()) {
    lines.push("", "## 现有提示词（可在其基础上优化）", input.existingPrompt.trim());
  }

  if (input.duration <= 15) {
    lines.push("", "## 输出要求", "- 生成 2-3 个不同风格版本");
  } else {
    lines.push(
      "",
      "## 输出要求",
      "- 视频超过 15 秒，按 skill 中的分段策略输出",
      "- 若拆成多段，将完整方案写入第一个版本的 prompt 字段，title 标注「多段方案」"
    );
  }

  lines.push(
    "",
    "## 硬性约束",
    "- 所有提示词必须使用中文",
    "- 每个版本 prompt 必须可直接复制到即梦平台使用",
    `- 单个 prompt 不超过 ${MAX_PROMPT_CHARS} 字符`,
    "- 有参考素材时必须正确使用 @图片1 / @视频1 / @音频1 官方命名",
    "- 15 秒及以下视频优先使用时间戳分镜（如 0-3s：...）",
    "- 只输出 JSON，不要输出 markdown 代码块"
  );

  return lines.join("\n");
}

function readVersionFields(record: Record<string, unknown>) {
  const title = String(
    record.title || record.标题 || record.version_title || record.name || record.版本标题 || ""
  ).trim();
  const prompt = String(
    record.prompt || record.提示词 || record.content || record.text || record.正文 || ""
  ).trim();
  const note = String(record.note || record.备注 || record.说明 || "").trim();
  return { title, prompt, note };
}

function normalizeVersions(data: unknown): SeedancePromptVersion[] {
  if (!data || typeof data !== "object") return [];
  const versions = (data as { versions?: unknown }).versions;
  if (!Array.isArray(versions)) return [];

  return versions
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const { title, prompt, note } = readVersionFields(item as Record<string, unknown>);
      const normalizedPrompt = normalizePromptWhitespace(prompt).slice(0, MAX_PROMPT_CHARS);
      if (!title || !normalizedPrompt) return null;
      return {
        title,
        prompt: normalizedPrompt,
        ...(note ? { note: normalizePromptWhitespace(note) } : {}),
      };
    })
    .filter(Boolean) as SeedancePromptVersion[];
}

function extractVersionsFromUnknown(data: unknown): SeedancePromptVersion[] {
  const direct = normalizeVersions(data);
  if (direct.length) return direct;

  if (Array.isArray(data)) {
    return normalizeVersions({ versions: data });
  }

  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;

  if (typeof record._rawMarkdown === "string" && record._rawMarkdown.trim()) {
    return parseVersionsFromMarkdown(record._rawMarkdown);
  }

  if (Array.isArray(record.data)) {
    return normalizeVersions({ versions: record.data });
  }

  const versionEntries = Object.entries(record).filter(([key]) => /版本|version/i.test(key));
  if (versionEntries.length) {
    return versionEntries
      .map(([key, value]) => {
        if (typeof value === "string" && value.trim()) {
          return { title: key, prompt: value.trim().slice(0, MAX_PROMPT_CHARS) };
        }
        if (!value || typeof value !== "object") return null;
        const fields = readVersionFields(value as Record<string, unknown>);
        const title = fields.title || key;
        const prompt = fields.prompt.slice(0, MAX_PROMPT_CHARS);
        if (!prompt) return null;
        return { title, prompt, ...(fields.note ? { note: fields.note } : {}) };
      })
      .filter(Boolean) as SeedancePromptVersion[];
  }

  return [];
}

function parseVersionsFromMarkdown(content: string): SeedancePromptVersion[] {
  const text = String(content || "").trim();
  if (!text) return [];

  const versions: SeedancePromptVersion[] = [];
  const sectionPattern =
    /###\s*版本[^:\n]*[:：]?\s*([^\n]+)[\s\S]*?####\s*提示词\s*\n+([\s\S]*?)(?=\n###\s*版本|\n####\s*参考素材|\n---|\n##\s*提示词解析|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = sectionPattern.exec(text)) !== null) {
    const title = match[1]?.trim();
    const prompt = match[2]
      ?.replace(/\n####[\s\S]*$/m, "")
      .trim()
      .slice(0, MAX_PROMPT_CHARS);
    if (title && prompt) {
      versions.push({ title, prompt });
    }
  }
  if (versions.length) return versions;

  const singleMatch = text.match(/####\s*提示词\s*\n+([\s\S]+)/i);
  if (singleMatch?.[1]?.trim()) {
    return [{ title: "AI 生成版", prompt: singleMatch[1].trim().slice(0, MAX_PROMPT_CHARS) }];
  }

  return [];
}

function extractVersionsFromLooseJson(text: string): SeedancePromptVersion[] {
  const versions: SeedancePromptVersion[] = [];
  const pattern =
    /"(?:title|标题)"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"(?:prompt|提示词)"\s*:\s*"((?:\\.|[^"\\])*)"/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const title = match[1]?.replace(/\\"/g, '"').trim();
    const prompt = normalizePromptWhitespace(match[2]?.replace(/\\"/g, '"') || "").slice(0, MAX_PROMPT_CHARS);
    if (title && prompt) {
      versions.push({ title, prompt });
    }
  }

  return versions;
}

function extractVersionsFromRawContent(rawContent: string, parsedData?: unknown): SeedancePromptVersion[] {
  const fromParsed = extractVersionsFromUnknown(parsedData);
  if (fromParsed.length) return fromParsed;

  const trimmed = String(rawContent || "").trim();
  if (!trimmed) return [];

  try {
    const reparsed = extractVersionsFromUnknown(parseStructuredContent(trimmed, "MiniMax"));
    if (reparsed.length) return reparsed;
  } catch {
    // ignore and continue with loose-json / markdown fallback
  }

  const fromLooseJson = extractVersionsFromLooseJson(trimmed);
  if (fromLooseJson.length) return fromLooseJson;

  const fromMarkdown = parseVersionsFromMarkdown(trimmed);
  if (fromMarkdown.length) return fromMarkdown;

  const prose = trimmed
    .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
  if (prose.length >= 80 && !prose.startsWith("{")) {
    return [{ title: "AI 生成版", prompt: prose.slice(0, MAX_PROMPT_CHARS) }];
  }

  return [];
}

export async function generateSeedancePrompts(
  input: GenerateSeedancePromptInput
): Promise<GenerateSeedancePromptResult> {
  const brief = input.brief.trim();
  if (!brief) throw new Error("请先描述你想生成的视频内容");

  const skillBody = await loadSeedancePromptSkillBody();
  const systemPrompt = [
    skillBody,
    "",
    "---",
    "",
    "你正在为项目内的「AI 视频生成」页面生成提示词。",
    "用户已在表单中填好时长、比例、模式与参考素材，你必须直接使用这些参数，不要反问用户。",
    "返回 JSON，结构见 schema。versions 数组中每个 prompt 字段必须是完整、可直接提交生成的最终提示词正文。",
    "务必严格输出 JSON 对象，格式示例：",
    '{"versions":[{"title":"版本一","prompt":"15秒..."},{"title":"版本二","prompt":"15秒..."}]}',
    "不要输出 markdown 标题，不要输出代码块。",
  ].join("\n");

  const result = await callMiniMaxStructured({
    model: DEFAULT_MODEL,
    schemaName: "seedance_video_prompts",
    schema: PROMPT_SCHEMA,
    temperature: 0.65,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildUserMessage(input) },
    ],
  });

  const versions = extractVersionsFromRawContent(result.rawContent, result.data);
  if (!versions.length) {
    throw new Error("MiniMax 未返回有效的提示词版本");
  }

  return { versions, model: DEFAULT_MODEL };
}

export function getSeedancePromptModelName() {
  return DEFAULT_MODEL;
}
