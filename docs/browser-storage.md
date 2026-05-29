# 浏览器端 localStorage 缓存

前端持久化 UI 状态（筛选、多选、主题等）时，使用 **`lib/browserStorage.ts`**，不要在业务代码里直接访问 `window.localStorage`。

## API

```ts
import {
  readLocalStorageJson,
  readLocalStorageJsonNullable,
  writeLocalStorageJson,
  readLocalStorageString,
  writeLocalStorageRaw,
  removeLocalStorageItem,
} from "@/lib/browserStorage";
```

| 函数 | 说明 |
| --- | --- |
| `readLocalStorageJson(key, fallback)` | 读 JSON；无值或解析失败返回 `fallback` |
| `readLocalStorageJsonNullable(key)` | 读 JSON；无值返回 `null` |
| `writeLocalStorageJson(key, value)` | 写 JSON，返回 `boolean` 表示是否成功 |
| `readLocalStorageString` / `writeLocalStorageRaw` | 纯字符串 |
| `removeLocalStorageItem(key)` | 删除 |

SSR 安全：非浏览器环境读操作返回 `fallback`/`null`，写操作静默失败。

## 推荐结构

1. **`lib/browserStorage.ts`** — 通用读写。
2. **`lib/<domain>/*-cache.ts`** — 定义 cache key、类型、校验与 `read*` / `write*`。

示例（抖创看板筛选，`lib/creator/insights-filter-cache.ts`）：

```ts
import { readLocalStorageJsonNullable, writeLocalStorageJson } from "@/lib/browserStorage";

export const CREATOR_INSIGHTS_FILTER_CACHE_KEY = "creator:insightsFilters";

export function readCreatorInsightsFiltersCache() { /* 校验后返回 */ }
export function writeCreatorInsightsFiltersCache(snapshot: ...) {
  writeLocalStorageJson(CREATOR_INSIGHTS_FILTER_CACHE_KEY, snapshot);
}
```

页面侧：挂载 `useEffect` 读取并 `setState`；筛选变化后 `useEffect` 写入。

## 已有 key 一览

见 [CLAUDE.md](../CLAUDE.md) 中「浏览器端 localStorage 缓存」表格。改名会导致用户本地缓存失效。

## 例外

`app/layout.tsx` 内联脚本在首屏 hydration 前读取 `autogetdy-ui-theme`，仍使用原生 `localStorage.getItem`，须与 `APP_UI_THEME_STORAGE_KEY`（`lib/appUiTheme.ts`）一致。
