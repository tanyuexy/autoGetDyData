---
name: douyin-video-download
description: Download Douyin www.douyin.com/video links as MP4 using Playwright and existing creator account cookies. Use when the user asks to download a Douyin video, save a douyin.com link to mp4, or fetch video files from Douyin share URLs.
allowed-tools: Bash(node:*) Bash(npx:*)
---

# Douyin Video Download

Use this skill when the user gives a Douyin video URL and wants a local MP4 file.

## Why not yt-dlp alone

`yt-dlp` on Douyin often fails with:

```text
Fresh cookies (not necessarily logged in) are needed
```

This project already stores valid `.douyin.com` cookies under `storage/creator-accounts/<账号>/storageState.json`. Reuse them with Playwright, read the page `<video>` `currentSrc`, then download the CDN URL with Referer + Cookie headers.

## Quick start

From repo root:

```bash
node .claude/skills/douyin-video-download/scripts/download-douyin-video.js \
  "https://www.douyin.com/video/7635260293485296122"
```

Default output: `./<videoId>.mp4` in the current working directory.

Specify output path:

```bash
node .claude/skills/douyin-video-download/scripts/download-douyin-video.js \
  "https://www.douyin.com/video/7635260293485296122" \
  -o ./7635260293485296122.mp4
```

Pick a creator account cookie jar:

```bash
node .claude/skills/douyin-video-download/scripts/download-douyin-video.js \
  "https://www.douyin.com/video/7635260293485296122" \
  -a 普济堂官方旗舰店
```

## Agent workflow

1. Read this skill.
2. Extract or confirm the Douyin video URL / ID.
3. Run the bundled script from repo root.
4. If no `--output` is given and the user asked for repo root, run in repo root so the file lands at `./<videoId>.mp4`.
5. Verify success from script JSON output (`ok: true`, non-zero `bytes`).
6. Report the final absolute path and file size to the user.

## Supported URL formats

- `https://www.douyin.com/video/<id>`
- `https://www.douyin.com/...?...modal_id=<id>`
- bare numeric id: `7635260293485296122`

## Prerequisites

- Node dependencies already installed in this repo (`playwright` available).
- At least one creator account with `storage/creator-accounts/<账号>/storageState.json`.
- If download fails with empty video URL or login wall, rerun `creator:login` for that account and retry with `-a`.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `未找到账号目录` | Run `node scripts/run.js creator:login <账号>` first |
| `未能从页面获取视频地址` | Try another account via `-a`, or refresh login cookies |
| Downloaded file is tiny / broken | Retry; script prefers `<video>.currentSrc` over network sniffing |
| User wants project root | Run script with cwd = repo root and `-o ./<id>.mp4` if needed |

## Notes

- Downloaded quality follows what Douyin serves on the web page (often not the highest bitrate).
- Do not commit downloaded MP4s or cookie files to git.
- This skill targets **www.douyin.com/video** pages, not creator-center export flows.
