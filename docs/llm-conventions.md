# LLM 调用规范

本仓库内所有结构化 LLM 调用（`lib/llm/*`、`/api/llm/structured`、以及基于 `StructuredRequest` 的业务逻辑，如 Seedance 提示词生成）须遵守下列约定。

## maxTokens：永远不要限制输出长度

**禁止**在请求体或类型定义中传入任何用于限制模型输出 token 数的参数，包括但不限于：

| 禁止字段（各厂商命名） | 说明 |
| --- | --- |
| `maxTokens` | 本仓库 `StructuredRequest` 曾用字段，已移除，不得恢复 |
| `max_tokens` | OpenAI 兼容 Chat Completions 常见字段 |
| `max_completion_tokens` | MiniMax 等厂商对 completion 上限的字段 |

### 必须遵守

1. **不要**在 `StructuredRequest`、`buildStructuredPayload`、`callStructuredJson` 的调用方、各 provider（`minimax.ts`、`deepseek.ts`、`siliconflow.ts` 等）或 `app/api/llm/structured/route.ts` 中重新加入上述字段。
2. **不要**为「省 token」「防止跑太长」而设硬上限；结构化 JSON（如 Seedance 多段提示词、片名生成）被截断会导致解析失败或 silently 残缺，比多耗 token 更严重。
3. **不要**在环境变量或配置里增加全局 `MAX_TOKENS` 一类开关并默认启用；若未来确有计费硬顶需求，须单独评审并在本文档记录例外，而不是默认加 cap。

### 若输出过长或不稳定，应这样处理

- 收紧 **JSON Schema**（减少字段、缩短 `description`、降低 `maxItems`）。
- 拆分多次调用（例如按镜头分批生成提示词），而不是单次调用加 `max_tokens`。
- 调整 **temperature / top_p** 或 **prompt**，而不是限制 completion 长度。
- MiniMax 结构化调用保持 `reasoning_split: true`（见 `lib/llm/minimax.ts`），勿再叠加上限字段。

### 相关代码位置（审查 PR 时对照）

- `lib/llm/types.ts` — `StructuredRequest` 无 `maxTokens`
- `lib/llm/shared.ts` — `buildStructuredPayload` 不组 `max_tokens`
- `lib/llm/minimax.ts` — `buildMinimaxStructuredPayload` 不传 `max_completion_tokens`
- `app/api/llm/structured/route.ts` — 请求体不接受 `maxTokens`
- `lib/ai-video/seedancePromptGenerator.ts` 等业务调用 — 勿写 `maxTokens: 4096` 等魔法数

### 历史原因（2026-05）

曾因 `maxTokens: 4096` 导致 Seedance 提示词 JSON 在尾部被截断、解析失败；同时 MiniMax 在带 `max_completion_tokens` 时与 `reasoning_split` 组合行为不理想。故全库统一：**永远不设输出 token 上限，交给模型与厂商默认**。
