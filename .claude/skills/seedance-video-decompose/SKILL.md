---
name: seedance-video-decompose
description: Analyzes reference MP4s, plans 15-second Seedance 2.0 shot lists with Chinese prompts, and extracts first/last frames per story beat. Use when converting Douyin or product videos to 即梦/Seedance prompts, decomposing videos into segments, or exporting segment keyframes for 全能参考 or 首尾帧 modes.
allowed-tools: Bash(node:*) Bash(ffmpeg:*) Bash(ffprobe:*)
---

# Seedance 视频拆解（分析 → 15s 提示词 → 首尾帧）

将参考视频拆解为 **Seedance 2.0 可用的 15 秒分镜提示词**，并从原片截取各节拍 **首帧 / 尾帧** 图片。

## 依赖

- 系统已安装 `ffmpeg`、`ffprobe`
- 本地 MP4（抖音链接先用 [douyin-video-download](../douyin-video-download/SKILL.md)）
- 写提示词时阅读 `docs/seedance-prompt-skill.md`（或项目 `seedance` skill）

## Quick start

```bash
# 1) 探测 + 采样（供 Agent 看图分析）
node .claude/skills/seedance-video-decompose/scripts/decompose-video-for-seedance.js run \
  ./7640763631806544457.mp4

# 2) 编写 segments.json 后截取首尾帧（可用 examples 作模板）
node .claude/skills/seedance-video-decompose/scripts/decompose-video-for-seedance.js extract \
  ./7640763631806544457.mp4 \
  -s ./7640763631806544457-seedance-decompose/segments.json \
  -o ./7640763631806544457-seedance-decompose/frames
```

默认输出目录：`<视频同目录>/<videoId>-seedance-decompose/`。

## Agent 工作流（必须按序）

### 1. 准备视频

- 已有 MP4 → 继续
- 仅有抖音 URL → 先 `douyin-video-download`，得到 `./<videoId>.mp4`

### 2. 采样分析

```bash
node .claude/skills/seedance-video-decompose/scripts/decompose-video-for-seedance.js run <video.mp4>
```

- 阅读 `probe.json`（时长、9:16/16:9）
- 查看 `_samples/` 下采样图（默认每 0.5s、前 20s），归纳 **3–5 个叙事节拍**

### 3. 规划 15 秒 + 写提示词

- 节拍**重新映射**到合计 15 秒（不要按原片秒数 1:1）
- 用**时间戳分镜**写完整中文 `seedancePrompt`（规范见 `docs/seedance-prompt-skill.md`）
- 为每个节拍标注原片 `startSec` / `endSec`（用于截帧，见 [REFERENCE.md](REFERENCE.md)）

### 4. 保存 segments.json

写入 `<outDir>/segments.json`。字段与示例：

- [REFERENCE.md](REFERENCE.md) — schema 与映射规则
- [examples/7640763631806544457.segments.json](examples/7640763631806544457.segments.json)

可选：同步写入 `<outDir>/seedance-prompt.md`（内容与 `seedancePrompt` 字段相同）。

### 5. 截取首尾帧

```bash
node .claude/skills/seedance-video-decompose/scripts/decompose-video-for-seedance.js extract \
  <video.mp4> -s <outDir>/segments.json -o <outDir>/frames
```

产出：`01-<label>-首帧.jpg`、`01-<label>-尾帧.jpg` … 及 `frames/manifest.json`。

### 6. 交付用户

报告：

| 项目 | 路径 |
|------|------|
| 15 秒提示词 | `segments.json` → `seedancePrompt` 或 `seedance-prompt.md` |
| 首尾帧目录 | `frames/` |
| 原片时间对照表 | 各 segment 的 `startSec`–`endSec` 与 `seedanceSlice` |

说明即梦用法：首尾帧模式 / `@图片1`… 上传 `frames/` 内图片。

## 子命令

| 命令 | 作用 |
|------|------|
| `probe` | 仅输出 JSON 元数据 |
| `sample` | 采样帧到 `_samples/` |
| `extract` | 按 segments.json 截首尾帧 |
| `run` | probe + sample（若已有 `-s` 则再 extract） |

参数：`-o` 输出目录、`--interval` 采样间隔、`--max-sec` 采样上限秒数。

## 注意

- `startSec`/`endSec` 对齐**原片**关键瞬间；`seedanceSlice` 对齐**15 秒**成片
- 参考视频含写实真人正脸可能被即梦拦截；优先无脸产品/手部镜头
- 勿将 MP4、`*-seedance-decompose/` 提交 git

## 故障排查

| 现象 | 处理 |
|------|------|
| `ffmpeg not found` | 安装 ffmpeg |
| 截帧画面不对 | 用 `_samples` 微调 `startSec`/`endSec` 后重新 `extract` |
| 原片 >15s | 只映射核心节拍进 15s；更长叙事用 Seedance「视频延长」分段 |
