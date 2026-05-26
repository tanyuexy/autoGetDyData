# segments.json 与 15 秒映射

## segments.json 结构

```json
{
  "videoId": "7640763631806544457",
  "targetDurationSec": 15,
  "seedancePrompt": "完整 15 秒中文提示词，可直接粘贴即梦",
  "segments": [
    {
      "id": "01",
      "label": "拉柜子",
      "startSec": 0,
      "endSec": 1.0,
      "seedanceSlice": "0-3秒【拉柜子】：俯拍白色抽屉，双手拉开…"
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `startSec` / `endSec` | **原视频**时间轴（秒），用于 `extract` 截首尾帧 |
| `seedanceSlice` | 映射到 **15 秒**成片后的时间戳分镜（写入 `seedancePrompt`） |

## 原视频 → 15 秒 映射原则

1. 先归纳 3–5 个**叙事节拍**（如：拉柜 / 满柜 / 拿货 / 指读），不照搬原片时长。
2. 将节拍**重新分配**到合计 15 秒内（常用 3+3+3+6 或 3+3+4+5）。
3. `startSec`/`endSec` 必须在原片 `durationSec` 内；用 `sample` 输出的 `_samples/` 帧图校准。
4. 首尾帧：`startSec` → 首帧，`endSec` → 尾帧（选该节拍**最具代表性**的瞬间，而非盲目等分）。

## 输出目录结构

```
<videoId>-seedance-decompose/
├── probe.json
├── samples-index.json
├── _samples/
├── segments.json
├── seedance-prompt.md          # 可选
└── frames/
    ├── 01-拉柜子-首帧.jpg
    ├── 01-拉柜子-尾帧.jpg
    └── manifest.json
```

## Seedance 提示词规范

完整写法见仓库 `docs/seedance-prompt-skill.md`。本 skill 负责拆解与截帧；写提示词时 Agent 必须阅读该文档。
