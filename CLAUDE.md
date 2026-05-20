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

### 浏览器测试（playwright-cli）

需要用真实浏览器做页面验证、DOM 调试或复现 Playwright 自动化流程时：**先读取并遵循本仓库的 playwright-cli skill**（`.claude/skills/playwright-cli/SKILL.md`），按其中的 `playwright-cli` 命令与 snapshot / refs 交互；不要凭空写选择器或臆测页面结构，在操作的时候每一步操作告诉我你的思考与后续详细执行步骤。

### Frontend → API → Script → internal API callback

Pages call API routes → API enqueues a task → the Playwright script scrapes data → script calls back to an internal API (e.g. `/api/review/save`, `/api/feishu/sync`) via `scripts/common/internal-api-client.js` to persist results. The internal API base URL defaults to `http://127.0.0.1:3000` (overridable via `INTERNAL_API_BASE_URL`).

### SSE task monitoring

`contexts/TaskContext.tsx` provides `startTask(url, body, namespace)` which POSTs to an API, gets back a `taskId`, then connects to `/api/progress/[taskId]` (SSE). The SSE endpoint polls the on-disk task log (`lib/taskLogStore.ts`) every 500ms and emits `log`, `progress`, and `done` events. The context auto-reconciles finished tasks by polling `/api/progress/tasks` every 3s — if a tracked task disappears from the running list, it loads the disk snapshot and marks it done.

### Creator account automation

All Douyin Creator Playwright scripts reuse `scripts/douyin-creator/core/browser-login.js` (`openTargetAndEnsureLogin`).

**抖创 Cookie / 登录态目录（仓库根下）：** `storage/creator-accounts/<name>/`。每个账号子目录含 Playwright **`storageState.json`**、**`cookies.json`** 及导出数据；脚本复用这些文件以减少重复登录。勿将含真实会话的内容提交到公开远程。

The login flow detects the current stage (QR code, SMS, face verification) via DOM inspection and sends email alerts (`lib/mail.js`) when manual intervention is needed.

### Shop account automation

**Two modes:**

- `shop:login` — pure login only, saves cookies and exits (no data export)
- `shop:export` — full login + post-login flow (shop selection → data download → merge → Feishu sync)

Both use `scripts/douyin-shop/cli.js` with different command branches. Accounts stored under `storage/shop-accounts/<email>/`.

**Login state verification (3-layer):**

1. **Static cookie analysis** (`lib/cookie-checker.ts`): `analyzeStorageState()` checks `storageState.json` — cookie expiry dates, file age (14-day threshold). No browser needed.

2. **Browser verification snapshot** (`verified-at.json`): Written by login flow (always `verified: true`) and verify API. 24-hour validity.

3. **Active browser verification** (`POST /api/shop/verify`): Launches headless Chromium, navigates to shop home, uses shared stage detection from `scripts/douyin-shop/lib/page-utils.js`.

**Merge logic** (`mergeVerificationIntoAnalysis()` in `cookie-checker.ts`): Browser result only overrides static analysis when `verified-at.json` timestamp ≥ `storageState.json` mtime (i.e., verification was done after last login).

**Stage detection** (`page-utils.js` `detectStage()`): Recognizes LOGIN_FORM (phone + email tabs), SHOP_PICKER, COMPASS_VIDEO, COMPASS_GRAPHIC, COMPASS_OTHER, FXG_WORKSPACE, CAPTCHA, UNKNOWN. `isAuthenticatedStage()` returns true for SHOP_PICKER + all COMPASS/FXG stages.

**Key login flow** (`login.js` `runShopLogin()`):

- Tries cookie reuse first (`tryReuseCookieLogin`)
- Falls back to full email+password login with captcha handling
- Supports `loginOnly` option to skip `runPostLoginFlow()` (shop selection + data export)
- `saveStorageState()` writes both `storageState.json` and `verified-at.json`

### MongoDB 连接与本地查询

应用通过 `lib/db/mongo.ts` 连接 MongoDB，环境变量（`.env`）通常为：

- `MONGODB_URI` — 连接串，本地开发常见为 `mongodb://127.0.0.1:27017`
- `MONGODB_DB` — 数据库名，未设置时默认 `autoGetDyData`（与代码中 `DEFAULT_DB_NAME` 一致）

命令行直接查库（示例与当前 `.env` 对齐时）：

```bash
mongosh "mongodb://127.0.0.1:27017/autoGetDyData"
# 或先连实例再切库：mongosh mongodb://127.0.0.1:27017 → use autoGetDyData
```

### MongoDB collections

- `app_config` — singleton config document (`_id: "default"`)
- `task_jobs` — queued/running/completed tasks for the background worker
- `runtime_processes` — child process registry for crash recovery
- `creator_publish_tasks` — publish task queue with Feishu record linking
- `creator_review_items` — scraped review/audit status of published posts
- `shop_export_items` — shop data export records

### 飞书发布任务同步与 Hash 判断

实现位于 `lib/feishu/sync-publish-tasks.ts`。飞书发布任务导入/刷新本地任务时的规则如下。

**1. 前置同步条件**

每次导入或刷新先读飞书任务表。仅当记录同时满足以下条件才进入后续同步判断；否则直接跳过：

```text
是否需要自动化 != 否
审批 = 通过
备注 != 示例
所属店铺 有值
视频/图文内容 有附件
```

日志会输出同步规则与跳过统计（例如满足条数、各类跳过原因计数）。

**2. 候选记录的短路跳过**

通过前置条件后，先做不依赖 hash 的短路判断：

```text
本地任务 status = running -> 跳过，不更新

飞书「已创建任务」= 是 -> 跳过，不更新

本地不存在该任务，且飞书「已创建任务」不是空/否 -> 跳过，不新建
```

上述通过后才计算 hash。

**3. 两种 Hash**

| 名称 | 函数 | 来源 | 包含字段概要 | 用途 |
| --- | --- | --- | --- | --- |
| **飞书完整 Hash** | `buildFeishuContentHash(snapshot)` | 飞书当前行快照 | 所属店铺；任务类型 video/article；标题；正文；AI内容；计划发布时间 `scheduleAt`；挂车链接；挂车产品名；附件信息（file_token / 文件名 / 类型 / 大小） | 判断飞书行是否变化，尤其附件是否变化。本地 Mongo 的 `feishuContentHash` 存此值。 |
| **本地核心 Payload Hash** | `buildCoreContentHash(buildTaskComparableInput(existingTask))` | 本地 Mongo 已保存任务 payload | 同上核心字段，但**不含**附件 file_token/size/type（本地仅存下载后的 `videoFileKey` / `imagesFileKeys`，无法与飞书原始附件一一等价比较） | 判断本地 payload 与飞书当前核心内容是否一致。 |

**4. 判断分支（已存在本地任务）**

```text
飞书核心 hash = 本地核心 payload hash 且 飞书完整 hash = 本地 feishuContentHash -> 无变化，跳过

飞书核心 hash = 本地核心 payload hash 但 飞书完整 hash != 本地 feishuContentHash -> 只补/更新 feishuContentHash，不重置任务内容

飞书核心 hash != 本地核心 payload hash -> 本地 payload 与飞书不一致，更新本地任务并重置为 pending
```

**本地不存在任务时：** `allowCreate = true` 且飞书「已创建任务」为空或否 → 新建本地任务。

**5. 为何两边都重新算**

旧逻辑只把飞书完整 hash 与本地 `feishuContentHash` 比较；若曾导入时本地 payload 不完整但 `feishuContentHash` 已是正确飞书内容的 hash，只要飞书不变会一直跳过，脏 payload 无法修复。双 hash 后可识别「飞书未变但本地核心与飞书不一致」并更新本地任务；审批不通过、示例、缺店铺、缺素材、已创建任务=是、`running` 等仍按前置规则直接跳过，不算 hash。

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
- `Space` 的 `direction` → 用 `orientation` 替代
- `Tag` 的 `bordered={false}`（antd v6）→ 用 **`variant="filled"`** 替代；“无边框实心”语义与旧时 `bordered={false}` 一致。**不要**把这些 Tag 写法套到 **`Table`** 上：`Table` 仍是 `bordered={false}` 控制是否显示格子线，`Table` 没有与 Tag 通用的 `variant` 用法。

### 企业微信推送与验证码回复

抖创登录验证可使用企业微信 webhook 推送提醒，但 webhook 只负责发消息，不接收用户回复。当前推荐链路是：企业微信推送公网 OTP 中转页链接（优先）或 `mailto:` 链接（兜底）→ 用户填写验证码 → 当前项目通过 HTTP 轮询 OTP 中转服务，再回退 IMAP 轮询并自动回填验证码。

相关配置：

- `WECOM_NOTIFY_ENABLED=true`
- `WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx`
- `WECOM_MENTION_USERS` / `WECOM_MENTION_MOBILES` 可选，用于提醒指定成员
- `OTP_BRIDGE_BASE_URL`：验证码填写页公网地址；配置后企微优先发这个链接
- `OTP_BRIDGE_ACCESS_TOKEN`：公网 OTP 中转服务的可选访问令牌
- `OTP_BRIDGE_TIMEOUT_MS`：当前项目轮询公网 OTP 中转服务的单次 HTTP 请求超时（单位：秒），默认 3600（1 小时）
- `OTP_REPLY_TO`：`mailto:` 链接中的验证码收件邮箱，默认回退到 `OTP_IMAP_USER`
- `OTP_IMAP_HOST` / `OTP_IMAP_USER` / `OTP_IMAP_PASS`：验证码收件箱 IMAP 轮询配置

不要把 `WECOM_WEBHOOK_URL`、`OTP_IMAP_PASS`、`SMTP_PASS` 等敏感信息提交到仓库。
