# 抖店导出流程状态机

本文档记录抖店登录、选店、数据导出流程的步骤状态输出规则。

## 状态机规则

抖店步骤通过 `scripts/douyin-shop/lib/step-runner.js` 的 `runStep` 执行，状态语义与发布流程一致。

| 状态 | 阶段 | 含义 |
| --- | --- | --- |
| `running` | `action` | 正在执行页面操作，例如打开页面、选日期、下载文件 |
| `running` | `verify` | 正在校验页面状态、日期或文件结果 |
| `passed` | `done` | 动作和校验均完成 |
| `failed` | `failed` | 动作或校验失败 |
| `skipped` | 无 | 该步骤按目标条件跳过 |

如果某个步骤没有独立校验函数，则只输出 `action` 和最终 `done`。显式跳过步骤只输出 `skipped`。

状态文件位置：

```text
storage/shop-export-debug/<账号邮箱>/<taskId或exportBatchId>/<runId>/shop-export-step-state.json
storage/shop-export-debug/<账号邮箱>/<taskId或exportBatchId>/<runId>/<flow>-steps.jsonl
```

手动运行且没有任务 ID / 导出批次时：

```text
storage/shop-export-debug/<账号邮箱>/_manual/<runId>/
```

失败截图和页面结构保存到当次运行的 `<runId>/` 子目录下，不再写入旧的 `storage/shop-accounts/<账号>/debug/`。

控制台会输出：

```text
[shop-export-step] {...}
```

心跳只写入 JSONL，不输出到控制台。

## 主要流程

| 序号 | tag | 步骤 | action | verify |
| --- | --- | --- | --- | --- |
| 1 | `check-cookie-login` | 检查缓存登录态 | 使用现有 cookie 直连工作台 | 无独立校验 |
| 2 | `open-login-page` | 打开抖店登录页 | 进入邮箱登录页 | 无独立校验 |
| 3 | `detect-login-stage` | 识别登录页阶段 | 等待登录表单、滑块、选店页或工作台阶段 | 阶段存在 |
| 4 | `fill-login-form` | 填写账号密码 | 切到邮箱登录，填写邮箱密码并勾选协议 | 无独立校验 |
| 5 | `click-login-button` | 点击登录按钮 | 点击登录按钮 | 无独立校验 |
| 6 | `detect-after-login-click-stage` | 识别登录后验证阶段 | 等待滑块、选店页或工作台 | 阶段存在 |
| 7 | `solve-login-captcha` | 处理登录滑块验证 | 自动处理滑块 | 自动滑块通过；失败后仍可进入人工等待 |
| 8 | `wait-login-settled` | 等待登录落地 | 等待进入选店页或已登录工作台 | 登录落地成功 |
| 9 | `save-storage-state` | 保存登录态 | 写入 storageState/cookies | 无独立校验 |
| 10 | `post-login-detect-stage` | 识别登录后页面阶段 | 判断选店页、罗盘页或工作台 | 阶段存在 |
| 11 | `select-shop-from-picker` | 选择目标店铺 | 在选店页选择目标店铺 | 已选中目标店铺 |
| 12 | `switch-first-shop` | 切换到第一个目标店铺 | 通过数据视角切换命中目标店铺 | 切换成功或明确无匹配 |
| 13 | `wait-shop-dom-loaded` | 等待店铺页面稳定 | 等待 DOM/load 稳定 | 无独立校验 |
| 14 | `preopen-video-page` | 预热短视频明细页 | 进入短视频明细页 | 无独立校验 |

## 每店铺短视频明细

每个店铺从 `1000 + 店铺序号 * 100` 开始编号。

| tag | 步骤 | action | verify |
| --- | --- | --- | --- |
| `video-open-page` | 进入短视频明细页 | 打开罗盘短视频明细页 | 筛选区就绪 |
| `video-select-date-N` | 选择短视频自然日 | 选择第 N 个目标日期 | 页面日期等于目标日期 |
| `video-select-non-ad-N` | 切换短视频非投放 | 切换到非投放 tab | 无独立校验 |
| `video-download-file-N` | 下载短视频明细文件 | 点击下载并保存文件 | 文件存在且非空 |
| `video-write-data-date-N` | 写入短视频数据日期 | 给导出文件追加数据日期列 | 文件仍存在且非空 |
| `video-skip-date-N` | 跳过短视频非目标日期 | 无动作 | `skipped` |

## 每店铺图文明细

每个店铺从 `1050 + 店铺序号 * 100` 开始编号。

| tag | 步骤 | action | verify |
| --- | --- | --- | --- |
| `graphic-open-page` | 进入图文分析页 | 打开罗盘图文分析页 | 图文主体就绪 |
| `graphic-select-date-N` | 选择图文自然日 | 选择第 N 个目标日期 | 页面日期等于目标日期 |
| `graphic-download-file-N` | 下载图文明细文件 | 点击下载并保存文件 | 文件存在且非空 |
| `graphic-write-data-date-N` | 写入图文数据日期 | 给导出文件追加数据日期列 | 文件仍存在且非空 |
| `graphic-skip-date-N` | 跳过图文非目标日期 | 无动作 | `skipped` |

## 多店铺切换

| tag | 步骤 | action | verify |
| --- | --- | --- | --- |
| `switch-next-shop-N` | 切换到下一个目标店铺 | 打开切换数据视角并选择下一家 | 返回切店结果 |

## 失败时可定位的信息

一次失败至少会留下：

| 文件 | 用途 |
| --- | --- |
| `<runId>/shop-export-step-state.json` | 本次运行最后一步状态 |
| `<runId>/<flow>-steps.jsonl` | 本次运行完整步骤流水 |
| `<runId>/<flow>-step-<tag>-failed.png/.yml` | 某一步失败时的截图与页面结构 |
| `<runId>/<flow>-step-<tag>-timeout.png/.yml` | 某一步超时时的截图与页面结构 |
| `<runId>/run-failed.png/.yml` | 步骤外失败的兜底截图与页面结构 |

可选环境变量：

- `SHOP_EXPORT_DEBUG_DIR`：覆盖 debug 根目录
- `SHOP_EXPORT_DEBUG_TZ`：debug 目录与步骤日志使用的时区，默认 `Asia/Shanghai`
- `SHOP_EXPORT_DEBUG_STEPS=true`：每个通过步骤也保存截图和页面结构
- `SHOP_EXPORT_DEBUG_SAVE_HTML=true`：额外保存完整 HTML
- `SHOP_EXPORT_DEBUG_SNAPSHOT_DEPTH=<N>`：限制 aria snapshot 深度
- `SHOP_EXPORT_STEP_TIMEOUT_MS=<ms>`：单步骤默认超时时间
- `SHOP_EXPORT_STEP_HEARTBEAT_MS=<ms>`：步骤心跳写入间隔
