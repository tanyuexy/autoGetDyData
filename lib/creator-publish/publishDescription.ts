/** 与 scripts/douyin-creator/publish/editor.js 保持一致 */
export const MAX_RECOGNIZED_HASHTAG_LENGTH = 10;

export type PublishDescriptionParts = {
  body: string;
  hashtags: string[];
  plainHashtags: string[];
  normalizedText: string;
};

export type ValidateFeishuAiContentResult =
  | { ok: true; parts: PublishDescriptionParts }
  | { ok: false; reason: string };

export const FEISHU_AI_CONTENT_FORMAT_HINT =
  "输出格式：先写完整正文（正文内不要出现 # 话题），空一行，最后一行仅写 #标签1 #标签2 …（空格分隔，标签行不要再写正文句子）。必须同时包含正文和话题标签。";

/** 药品/健康类品名常见剂型或标识，用于 AI 正文生成走推广向规则 */
const MEDICINE_PRODUCT_NAME_PATTERN =
  /(?:滴丸|软胶囊|胶囊|片剂|片|颗粒|口服液|合剂|散|膏|贴膏|贴|药|OTC|otc|中成药|处方药)/u;

/** 药品话题标签中禁止使用的症状/疾病类词（须与正文合规表述区分） */
const MEDICINE_SYMPTOM_HASHTAGS = [
  "头晕",
  "头痛",
  "偏头痛",
  "失眠",
  "健忘",
  "抑郁",
  "焦虑",
  "咳嗽",
  "感冒",
  "发烧",
  "发热",
  "胃痛",
  "胃疼",
  "腹泻",
  "便秘",
  "过敏",
  "疣",
  "高血压",
  "糖尿病",
  "贫血",
  "风湿",
  "关节痛",
  "嗓子疼",
  "咽喉痛",
];

const LLM_REFUSAL_PATTERNS = [
  /不太适合帮助/i,
  /无法帮助(?:您|你)?(?:生成|撰写|编写)/i,
  /不能帮助(?:您|你)?(?:生成|撰写|编写)/i,
  /(?:抱歉|对不起)[，,]?我(?:无法|不能)/i,
  /i(?:'m| am) not (?:able|in a position) to/i,
  /cannot help (?:you )?with/i,
];

function cleanHashtag(tag: string): string {
  return String(tag || "").replace(/\s+/g, "").trim();
}

function getHashtagLength(tag: string): number {
  return Array.from(tag).length;
}

function stripSpacesAfterHash(text: string): string {
  return String(text || "").replace(/#(\s+)/g, "#");
}

export function splitDescription(text: string): {
  body: string;
  hashtags: string[];
  plainHashtags: string[];
} {
  const hashtags: string[] = [];
  const plainHashtags: string[] = [];

  let body = stripSpacesAfterHash(text)
    .replace(/#([^\s#]+)/g, (_matched, rawTag) => {
      const tag = cleanHashtag(rawTag);
      if (!tag) return "";

      if (getHashtagLength(tag) > MAX_RECOGNIZED_HASHTAG_LENGTH) {
        if (!plainHashtags.includes(tag)) {
          plainHashtags.push(tag);
        }
        return rawTag.trim();
      }

      if (!hashtags.includes(tag)) {
        hashtags.push(tag);
      }
      return "";
    })
    .replace(/(^|\s)#(?=\s|$)/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!body && hashtags.length === 0 && plainHashtags.length === 0) {
    body = String(text || "").trim();
  }

  return { body, hashtags, plainHashtags };
}

export function normalizeDescriptionForPublish(text: string): PublishDescriptionParts {
  const { body, hashtags, plainHashtags } = splitDescription(text);
  const topicText = hashtags.map((tag) => `#${tag}`).join(" ");
  const normalizedText = [body, topicText].filter(Boolean).join("\n\n");
  return { body, hashtags, plainHashtags, normalizedText };
}

function parseHashtagsFromSection(section: string): string[] {
  const tags: string[] = [];
  for (const token of section.trim().split(/\s+/)) {
    if (!token.startsWith("#")) continue;
    const tag = cleanHashtag(token.slice(1));
    if (!tag) continue;
    if (getHashtagLength(tag) > MAX_RECOGNIZED_HASHTAG_LENGTH) continue;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function isPureHashtagSection(section: string): boolean {
  const trimmed = String(section || "").trim();
  if (!trimmed) return false;

  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return false;

  return tokens.every((token) => {
    if (!/^#[^\s#]+$/.test(token)) return false;
    const tag = cleanHashtag(token.slice(1));
    return Boolean(tag) && getHashtagLength(tag) <= MAX_RECOGNIZED_HASHTAG_LENGTH;
  });
}

export function extractBodyAndTagSection(
  text: string
): { bodyPart: string; tagSection: string } | null {
  const trimmed = stripSpacesAfterHash(String(text || "").trim());
  if (!trimmed) return null;

  const doubleNewlineParts = trimmed.split(/\n\n+/);
  if (doubleNewlineParts.length >= 2) {
    const tagSection = doubleNewlineParts[doubleNewlineParts.length - 1].trim();
    const bodyPart = doubleNewlineParts.slice(0, -1).join("\n\n").trim();
    if (bodyPart && isPureHashtagSection(tagSection)) {
      return { bodyPart, tagSection };
    }
  }

  const lines = trimmed.split("\n");
  if (lines.length >= 2) {
    const tagSection = lines[lines.length - 1].trim();
    const bodyPart = lines.slice(0, -1).join("\n").trim();
    if (bodyPart && isPureHashtagSection(tagSection)) {
      return { bodyPart, tagSection };
    }
  }

  const inlineMatch = trimmed.match(/^([\s\S]+?)\s+((?:#[^\s#]+\s*)+)$/);
  if (inlineMatch) {
    const bodyPart = inlineMatch[1].trim();
    const tagSection = inlineMatch[2].trim();
    if (bodyPart && isPureHashtagSection(tagSection)) {
      return { bodyPart, tagSection };
    }
  }

  return null;
}

export function isLlmRefusalContent(text: string): boolean {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  return LLM_REFUSAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function validateFeishuAiGeneratedContent(raw: string): ValidateFeishuAiContentResult {
  const text = String(raw || "").trim();
  if (!text) {
    return { ok: false, reason: "内容为空" };
  }
  if (isLlmRefusalContent(text)) {
    return { ok: false, reason: "模型拒答，未生成可用正文" };
  }

  const extracted = extractBodyAndTagSection(text);
  if (!extracted) {
    return {
      ok: false,
      reason: "格式不正确：需正文在前、话题标签在后，且标签行仅为 #标签（空格分隔）",
    };
  }

  const { bodyPart, tagSection } = extracted;
  if (!bodyPart.trim()) {
    return { ok: false, reason: "缺少正文（不能只有话题标签）" };
  }

  const tagSectionTags = parseHashtagsFromSection(tagSection);
  if (tagSectionTags.length === 0) {
    return { ok: false, reason: "缺少有效话题标签（不能只有正文）" };
  }

  if (/#[^\s#]+/.test(bodyPart)) {
    return { ok: false, reason: "正文中不应包含 # 话题，请把话题全部放在末尾单独一行" };
  }

  const tagSectionStart = text.indexOf(tagSection);
  if (tagSectionStart >= 0) {
    const bodyRegion = text.slice(0, tagSectionStart);
    for (const tag of tagSectionTags) {
      const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`#\\s*${escaped}(?![\\w\\u4e00-\\u9fff])`).test(bodyRegion)) {
        return { ok: false, reason: "话题标签不应穿插在正文中，请全部放在正文之后" };
      }
    }
  }

  const parts = normalizeDescriptionForPublish(`${bodyPart}\n\n${tagSection}`);
  if (!parts.body.trim()) {
    return { ok: false, reason: "缺少正文" };
  }
  if (parts.hashtags.length === 0) {
    return { ok: false, reason: "缺少话题标签" };
  }

  return { ok: true, parts };
}

export function isMedicineLikeProduct(productName: string): boolean {
  const name = String(productName || "").trim();
  if (!name) return false;
  return MEDICINE_PRODUCT_NAME_PATTERN.test(name);
}

function stripMedicineDosageFormSuffix(productName: string): string {
  return String(productName || "")
    .trim()
    .replace(/(?:软胶囊|滴丸|胶囊|片剂|片|颗粒|口服液|合剂|散|膏|贴膏|贴)$/u, "")
    .trim();
}

function bodyMentionsMedicineProduct(body: string, productName: string): boolean {
  const name = String(productName || "").trim();
  if (!name) return true;

  if (body.includes(name)) return true;

  const coreName = stripMedicineDosageFormSuffix(name);
  if (coreName.length >= 2 && body.includes(coreName)) return true;

  if (coreName.length >= 3 && body.includes(coreName.slice(0, 3))) return true;

  return false;
}

export function validateMedicinePromotionContent(
  parts: PublishDescriptionParts,
  productName: string
): ValidateFeishuAiContentResult {
  if (!bodyMentionsMedicineProduct(parts.body, productName)) {
    return {
      ok: false,
      reason: "药品正文须明确提及品名或品牌，不能整段只写氛围/颜值/仪式感",
    };
  }

  const blockedTags = parts.hashtags.filter((tag) =>
    MEDICINE_SYMPTOM_HASHTAGS.some((symptom) => tag === symptom || tag.includes(symptom))
  );
  if (blockedTags.length > 0) {
    return {
      ok: false,
      reason: `药品话题标签勿使用症状/疾病词：${blockedTags.join("、")}`,
    };
  }

  return { ok: true, parts };
}
