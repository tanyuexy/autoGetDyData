import { NextRequest, NextResponse } from "next/server";
import {
  callStructuredLlm,
  type JsonSchemaObject,
  type JsonValue,
  type LlmMessage,
  type LlmProvider,
} from "@/lib/llm";

export const maxDuration = 60;

interface StructuredRequestBody {
  provider?: LlmProvider;
  model?: string;
  schemaName?: string;
  schema?: JsonSchemaObject;
  messages?: LlmMessage[];
  temperature?: number;
  topP?: number;
}

function isValidRole(value: unknown): value is LlmMessage["role"] {
  return value === "system" || value === "user" || value === "assistant";
}

function isValidProvider(value: unknown): value is LlmProvider {
  return value === "siliconflow" || value === "deepseek" || value === "minimax";
}

function normalizeMessages(input: unknown): LlmMessage[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("messages 不能为空");
  }

  return input.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("messages 中每一项都必须是对象");
    }
    const role = (item as Record<string, unknown>).role;
    const content = (item as Record<string, unknown>).content;
    if (!isValidRole(role)) {
      throw new Error("messages.role 仅支持 system/user/assistant");
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("messages.content 必须是非空字符串");
    }
    return {
      role,
      content: content.trim(),
    };
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as StructuredRequestBody;

    const provider = body.provider || "minimax";
    if (!isValidProvider(provider)) {
      return NextResponse.json({ error: "invalid provider" }, { status: 400 });
    }

    const schemaName = String(body.schemaName || "").trim();
    if (!schemaName) {
      return NextResponse.json({ error: "missing schemaName" }, { status: 400 });
    }

    if (!body.schema || typeof body.schema !== "object" || Array.isArray(body.schema)) {
      return NextResponse.json({ error: "invalid schema" }, { status: 400 });
    }

    const messages = normalizeMessages(body.messages);

    const result = await callStructuredLlm<JsonValue>(provider, {
      model: body.model,
      schemaName,
      schema: body.schema,
      messages,
      temperature: typeof body.temperature === "number" ? body.temperature : 0,
      topP: typeof body.topP === "number" ? body.topP : undefined,
      signal: request.signal,
    });

    return NextResponse.json({
      ok: true,
      provider,
      data: result.data,
      usage: result.usage,
      rawContent: result.rawContent,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e) || "structured llm call failed" },
      { status: 500 }
    );
  }
}
