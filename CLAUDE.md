# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Next.js dev server (port 3000)
npm run dev:all      # Dev server + task worker
npm run build        # Production build
npm run start        # Production start
npm run worker       # Background task worker (MongoDB-backed queue consumer)
npm run worker:dev   # Task worker with --watch for development
npx tsc --noEmit     # TypeScript type check
```

**Scripts** (run via `node scripts/run.js <route>`):
- `creator:export` / `creator:export-feishu` — export post data from Douyin Creator, optionally sync to Feishu
- `creator:login` — manual login for creator accounts
- `creator:publish-video` / `creator:publish-article` — publish content
- `creator:open` — open browser to creator center (interactive)
- `creator:review` — scrape review/audit status of published posts
- `shop:export` / `shop:login` / `shop:sync-feishu` / `shop:retry-failed` — shop equivalents

## Architecture

### Task execution (2-layer)

1. **API-triggered** (`lib/taskManager.ts`): API routes call `enqueueTask()` → writes to MongoDB `task_jobs` (status: `queued`) → spawns `node scripts/run.js <route>` as child process. SSE channel streams logs back to the browser via `lib/sseManager.ts`. Uses in-memory `ChildProcess` tracking + `runtime_processes` collection for crash recovery.

2. **Background worker** (`scripts/workers/task-worker.js`): Polls `task_jobs` collection for `queued` items, spawns them, reports progress via `runtime_processes`. Used for long-running or scheduled tasks (e.g., publish automation at scheduled times).

Both layers share the same `scripts/run.js` routing table and namespace concurrency limits (`DEFAULT_MAX_CONCURRENT` in `taskManager.ts`).

### Script routing

`scripts/run.js` maps route names (e.g. `creator:export`) to entry scripts + CLI arguments. It loads `PROJECT_CONFIG_JSON` from MongoDB `app_config` and passes it as an env var to every child process. All Playwright scripts read this env var for runtime configuration instead of hitting MongoDB directly.

### Frontend → API → Script → internal API callback

Pages call API routes → API enqueues a task → the Playwright script scrapes data → script calls back to an internal API (e.g. `/api/review/save`, `/api/feishu/sync`) via `scripts/common/internal-api-client.js` to persist results. The internal API base URL defaults to `http://127.0.0.1:3000` (overridable via `INTERNAL_API_BASE_URL`).

### SSE task monitoring

`contexts/TaskContext.tsx` provides `startTask(url, body, namespace)` which POSTs to an API, gets back a `taskId`, then connects to `/api/progress/[taskId]` (SSE). The SSE endpoint polls the on-disk task log (`lib/taskLogStore.ts`) every 500ms and emits `log`, `progress`, and `done` events. The context auto-reconciles finished tasks by polling `/api/progress/tasks` every 3s — if a tracked task disappears from the running list, it loads the disk snapshot and marks it done.

### Creator account automation

All Douyin Creator Playwright scripts reuse `scripts/douyin-creator/lib/login.js` (`openTargetAndEnsureLogin`). Accounts are stored as directories under `storage/creator-accounts/<name>/` containing `storageState.json`, `cookies.json`, and exported data. The login flow detects the current stage (QR code, SMS, face verification) via DOM inspection and sends email alerts (`lib/mail.js`) when manual intervention is needed.

### MongoDB collections

- `app_config` — singleton config document (`_id: "default"`)
- `task_jobs` — queued/running/completed tasks for the background worker
- `runtime_processes` — child process registry for crash recovery
- `creator_publish_tasks` — publish task queue with Feishu record linking
- `creator_review_items` — scraped review/audit status of published posts
- `shop_export_items` — shop data export records

### New page checklist

To add a new page:
1. Create `app/(main)/<route>/page.tsx` ("use client", wrapped by `AppLayout` + `TaskProvider`)
2. Add menu item in `components/AppLayout.tsx` `menuItems` array
3. Add API routes under `app/api/<route>/`
4. If it triggers a Playwright task: register a route in `scripts/run.js`, add namespace to `TaskNamespace` in `lib/taskManager.ts`
5. If persistent data: create a service in `lib/`, add MongoDB indexes in `lib/db/mongo.ts`, define types in `types/index.ts`

### antd 组件使用规范

使用 antd 组件前，先确认该属性/方法在当前版本是否已弃用（deprecated）。遇到控制台 deprecation warning 时主动修复，不要留下已知的弃用警告。

已知的弃用项：
- `InputNumber` 的 `addonBefore` / `addonAfter` → 用 `Space.Compact` + `Button` 替代
- `Modal` 的 `destroyOnClose` → 用 `destroyOnHidden` 替代
