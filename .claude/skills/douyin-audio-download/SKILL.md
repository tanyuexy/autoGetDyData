---
name: douyin-audio-download
description: Download Douyin music/BGM audio as MP3 using Playwright, creator account cookies, and the web music detail API. Use when the user asks to fetch Douyin music, BGM, song audio, or a v.douyin.com share link that resolves to a /music/ page.
allowed-tools: Bash(node:*) Bash(npx:*)
---

# Douyin Audio Download

Use this skill when the user gives a Douyin **music** link or share URL and wants a local audio file.

## Why this path

Many Douyin share links (`v.douyin.com/...`) redirect to **`/music/<id>`**, not `/video/<id>`. The music page does not expose a playable `<audio>` tag in headless mode. Instead:

1. Reuse creator cookies from `storage/creator-accounts/<账号>/storageState.json`
2. Open the music page with Playwright
3. Call `/aweme/v1/web/music/detail/?music_id=...` **inside the browser** (`fetch` with credentials)
4. Read `music_info.play_url.url_list[0]`
5. Download CDN audio with `Referer` + `Cookie`
6. Convert to MP3 with bundled/system `ffmpeg`

Do **not** use `yt-dlp` on `/music/` URLs — it returns `Unsupported URL`.

If the link is actually a **video** page, use [douyin-video-download](../douyin-video-download/SKILL.md) instead.

## Quick start

From repo root:

```bash
node .claude/skills/douyin-audio-download/scripts/download-douyin-audio.js \
  "https://v.douyin.com/BAgRwCpjE8Q/"
```

Default output: `storage/downloads/<歌曲名>.mp3`

Specify output:

```bash
node .claude/skills/douyin-audio-download/scripts/download-douyin-audio.js \
  "https://www.douyin.com/music/7518780312132814882" \
  -o "./storage/downloads/真天下英雄-剪辑版.mp3"
```

Pick creator account cookies:

```bash
node .claude/skills/douyin-audio-download/scripts/download-douyin-audio.js \
  "https://v.douyin.com/BAgRwCpjE8Q/" \
  -a 维乐多官方旗舰店
```

Keep raw CDN file without ffmpeg conversion:

```bash
node .claude/skills/douyin-audio-download/scripts/download-douyin-audio.js \
  "https://www.douyin.com/music/7518780312132814882" \
  --no-convert
```

## Agent workflow

1. Read this skill.
2. Confirm the URL is music-related (`/music/`, or a short link that resolves to music).
3. Run the bundled script from repo root.
4. Check JSON output: `ok: true`, non-zero `bytes`, reasonable `duration`.
5. Report absolute output path, title, author, duration, and file size.

## Supported URL formats

- `https://www.douyin.com/music/<musicId>`
- `https://v.douyin.com/<code>/` (when it redirects to music)
- `https://www.iesdouyin.com/share/music/<musicId>`
- bare numeric music id: `7518780312132814882`

## Prerequisites

- Node deps installed (`playwright`, `fs-extra`, `@ffmpeg-installer/ffmpeg`).
- At least one creator account with `storage/creator-accounts/<账号>/storageState.json`.
- If API returns empty `play_url`, refresh login via `node scripts/run.js creator:login <账号>` and retry with `-a`.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `未找到账号目录` | Run `node scripts/run.js creator:login <账号>` first |
| `未能解析 music_id` | Open the share link manually; if it lands on `/video/`, switch to video-download skill |
| `未获取到 play_url` | Retry another account with `-a`, or refresh cookies |
| Download OK but tiny file | Wrong CDN URL; rerun script, do not reuse placeholder `uuu_265.mp4` from video pages |
| ffmpeg conversion fails | Install ffmpeg or set `FFMPEG_PATH`; use `--no-convert` to keep raw file |

## Notes

- Clip length follows Douyin music detail (`music_info.duration`, often ~30–60s for clips).
- Do not commit downloaded audio or cookie files to git.
- Default download dir is `storage/downloads/` under repo root.
