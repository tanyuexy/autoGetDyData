---
name: feishu-bitable-reader
description: Use when you need to inspect Feishu/Lark Bitable records in this project, verify field names/types/raw API values, compare a Feishu row with local Mongo task data, or debug why imported publish tasks differ from the Feishu table.
---

# Feishu Bitable Reader

Use this skill when debugging Feishu task-table imports, field mapping, row eligibility, schedule time parsing, or local Mongo payload mismatches.

## Quick Workflow

1. Read the live Feishu task table through the same project config path used by Next APIs:

```bash
./node_modules/.bin/tsx feishu-bitable-reader/scripts/read-bitable.ts --profile task --row 68 --search 锁阳固精丸
```

2. Inspect the output:

- `FIELDS` shows Feishu API field names, field IDs, and field types.
- `MATCH` blocks show records matching `--search` terms.
- `ROW` shows the API record at `--row`. Remember API order may not equal the current Feishu view order unless the API call is view-aware.
- Sensitive values matching `token`, `url`, or `link` keys are masked by default.

3. If investigating publish import behavior, compare:

- Feishu raw fields: `审批`, `已创建任务`, `计划发布时间`, `所属店铺`, `视频/图文内容`, `正文`.
- Local Mongo task fields: `feishuRecordId`, `feishuRowNumber`, `payload.scheduleAt`, `payload.description`, `status`, `feishuContentHash`.

## Useful Commands

Read field definitions only:

```bash
./node_modules/.bin/tsx feishu-bitable-reader/scripts/read-bitable.ts --profile task --fields-only
```

Search multiple terms:

```bash
./node_modules/.bin/tsx feishu-bitable-reader/scripts/read-bitable.ts --profile task --search 普济堂锁阳固精丸 --search 健康好物计划
```

Show a specific API row:

```bash
./node_modules/.bin/tsx feishu-bitable-reader/scripts/read-bitable.ts --profile task --row 68
```

Print all fields for matches instead of the common debug subset:

```bash
./node_modules/.bin/tsx feishu-bitable-reader/scripts/read-bitable.ts --profile task --search 锁阳固精丸 --all-fields
```

## Notes

- The script calls `getConfig()` first and injects `process.env.PROJECT_CONFIG_JSON`, matching the app-side Feishu config resolution.
- The default profile is `task`.
- Feishu date fields often arrive as millisecond timestamps. Convert them with:

```js
new Date(1778673600000).toISOString()
```

- For China-local display:

```js
new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  dateStyle: "medium",
  timeStyle: "short",
  hour12: false,
}).format(new Date(1778673600000))
```
