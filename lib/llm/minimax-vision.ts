import {
  asRecord,
  extractErrorMessage,
  normalizeBaseUrl,
  parsePositiveInt,
  postOpenAICompatibleJson,
} from "./shared";

const DEFAULT_API_HOST =
  process.env.MINIMAX_API_HOST?.trim() ||
  process.env.MINIMAX_BASE_URL?.trim()?.replace(/\/v1\/?$/, "") ||
  "https://api.minimaxi.com";
const DEFAULT_TIMEOUT_MS = parsePositiveInt(process.env.MINIMAX_VISION_TIMEOUT_MS, 120_000);
const PROVIDER_LABEL = "MiniMax Vision";

function resolveApiKey(): string {
  return (
    process.env.MINIMAX_API_KEY?.trim() ||
    process.env.MINIMAX_TOKEN_PLAN_KEY?.trim() ||
    ""
  );
}

function resolveApiHost(): string {
  return normalizeBaseUrl(DEFAULT_API_HOST, "https://api.minimaxi.com");
}

export function bufferToImageDataUrl(
  buffer: Buffer,
  mimeType?: string,
  fileName?: string
): string {
  const normalizedMime = String(mimeType || "").toLowerCase();
  let format = "jpeg";
  if (normalizedMime.includes("png") || String(fileName || "").toLowerCase().endsWith(".png")) {
    format = "png";
  } else if (
    normalizedMime.includes("webp") ||
    String(fileName || "").toLowerCase().endsWith(".webp")
  ) {
    format = "webp";
  } else if (
    normalizedMime.includes("gif") ||
    String(fileName || "").toLowerCase().endsWith(".gif")
  ) {
    format = "gif";
  }
  return `data:image/${format};base64,${buffer.toString("base64")}`;
}

export async function understandMiniMaxImage(options: {
  prompt: string;
  imageUrl: string;
  apiKey?: string;
  apiHost?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const apiKey = options.apiKey?.trim() || resolveApiKey();
  if (!apiKey) {
    throw new Error("缺少 MiniMax API Key，无法理解素材图片");
  }

  const prompt = String(options.prompt || "").trim();
  const imageUrl = String(options.imageUrl || "").trim();
  if (!prompt) throw new Error("图片理解 prompt 不能为空");
  if (!imageUrl) throw new Error("图片 imageUrl 不能为空");

  const apiHost = normalizeBaseUrl(options.apiHost || resolveApiHost(), "https://api.minimaxi.com");
  const response = await postOpenAICompatibleJson({
    url: `${apiHost}/v1/coding_plan/vlm`,
    apiKey,
    body: {
      prompt,
      image_url: imageUrl,
    },
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    signal: options.signal,
    headers: {
      "MM-API-Source": "autoGetDyData-feishu-ai-content",
    },
    providerLabel: PROVIDER_LABEL,
  });

  const root = asRecord(response);
  const content = String(root.content || "").trim();
  if (content) return content;

  const baseResp = asRecord(root.base_resp);
  if (baseResp.status_msg) {
    throw new Error(`${PROVIDER_LABEL}: ${String(baseResp.status_msg)}`);
  }

  throw new Error(`${PROVIDER_LABEL} 返回空内容: ${extractErrorMessage(response, "<empty>")}`);
}
