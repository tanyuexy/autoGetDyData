# 抖音创作者发布流程状态机

本文档记录当前自动发布任务的四种流程，以及每一步的动作、校验和状态输出规则。

## 状态机规则

所有发布步骤通过 `scripts/douyin-creator/publish/step-runner.js` 的 `runStep` 执行。

每个步骤最多包含三个阶段：

| 状态 | 阶段 | 含义 |
| --- | --- | --- |
| `running` | `action` | 正在执行页面操作，例如点击、填写、上传 |
| `running` | `verify` | 正在校验页面状态或填写结果 |
| `passed` | `done` | 动作和校验均完成 |
| `failed` | `failed` | 动作或校验失败 |
| `skipped` | 无 | 该步骤按配置跳过 |

如果某个步骤没有独立校验函数，则只会输出 `action` 和最终 `done`。如果是显式跳过步骤，则只输出 `skipped`。

状态文件位置：

```text
storage/creator-publish-debug/<店铺名>/<任务ID>/<runId>/publish-step-state.json
storage/creator-publish-debug/<店铺名>/<任务ID>/<runId>/<flow>-steps.jsonl
```

每次运行会在任务目录下创建以本地时间命名的子文件夹（`runId`，例如 `2026-05-19_14-08-01-219`）。**每次运行的步骤快照**保存在 `<runId>/publish-step-state.json`，重试后不会被覆盖。需要该任务**最近一次运行**的最终状态时，按 `runId` 字典序取最新子目录下的 `publish-step-state.json`（见 `readLatestPublishStepStateFromTaskDir`）。

手动运行且没有任务 ID 时：

```text
storage/creator-publish-debug/<店铺名>/_manual/<runId>/
```

失败截图和 HTML 保存到当次运行的 `<runId>/` 子目录下。

## 四种流程

四种流程由内容类型和是否配置购物车链接决定：

| 流程 | 入口 | 挂车判断 |
| --- | --- | --- |
| 视频挂车 | `creator:publish-video` | `productLink` 有值 |
| 视频不挂车 | `creator:publish-video` | `productLink` 为空 |
| 图文挂车 | `creator:publish-article` | `productLink` 有值 |
| 图文不挂车 | `creator:publish-article` | `productLink` 为空 |

发布按钮是否真实点击由 `publishEnabled` 控制。`publishEnabled=false` 时不会点击最终发布按钮，会输出发布跳过步骤。

## 飞书导入与自动入队规则

发布任务前端状态与本地 `creator_publish_tasks.status` 的对应关系：

| 本地状态 | 前端文案 | 含义 |
| --- | --- | --- |
| `pending` | 待执行 | 已创建但尚未进入发布执行队列 |
| `queued` | 队列中 | 等待后台 worker 拉起发布脚本 |
| `running` | 执行中 | 发布脚本正在运行 |
| `success` | 成功 | 发布脚本退出码为 0，若有飞书 record 会回写「已创建任务」= 是 |
| `failed` | 失败 | 发布脚本异常结束 |
| `cancelled` | 已取消 | 管理员手动终止或取消 |

飞书任务导入入口支持两种模式：

| 入口 | `autoStart` | 状态规则 |
| --- | --- | --- |
| 手动点击「从飞书导入任务」 | `false` | 新建任务为 `pending`；已有任务内容变化后重置为 `pending` |
| 配置管理「自动调度」触发 | `true` | 新建任务为 `queued`；已有任务内容变化后更新为 `queued`；已有任务内容无变化但本地为 `pending` 或 `cancelled` 时，也更新为 `queued` |

自动导入只处理满足飞书同步条件的记录：审批通过、非示例、已填所属店铺、已上传视频/图文内容，且店铺信息表未配置「是否需要自动化=否」。以下记录不会被自动入队：

- 本地同一飞书 record 的任务正在 `running`。
- 飞书「已创建任务」为「是」。
- 本地不存在任务且飞书「已创建任务」既不是空也不是「否」。
- 本地已有任务内容无变化，但状态不是 `pending` 或 `cancelled`，例如 `success`、`failed`、`queued`。

自动导入把 `pending` 或 `cancelled` 任务重新入队时，会清理 `lastError`、`taskId`、`pid`、`workerId`。如果任务原本有 `scheduleAt`，入队后仍按该定时时间执行；只有前端「立即执行」操作会清空 `scheduleAt`。

## 视频挂车流程

| 序号 | tag | 步骤 | action | verify |
| --- | --- | --- | --- | --- |
| 1 | `01-login` | 检查登录状态 | 检查账号登录态，必要时进入登录流程 | 动作内部完成登录确认 |
| 2 | `02-open-post-page` | 进入视频发布页 | 打开视频发布页并优化页面显示 | 等待标题输入框或编辑器出现 |
| 3 | `03-upload-video` | 上传视频素材 | 设置视频文件 | `checkVideoUploaded` 校验视频或封面素材出现 |
| 4 | `04-schedule` | 校验并设置定时发布 | 设置定时发布时间 | `checkScheduleSet` 校验日期选择器有值 |
| 5 | `05-product-link` | 设置购物车商品链接 | 选择购物车，填写商品链接、商品短标题、审批文号并完成编辑 | `checkProductLinkSet` 校验购物车已选中、商品已添加、弹窗已关闭、商品标题匹配 |
| 6 | `06-title-description-topics` | 填写标题、正文与话题 | 填写标题、正文、话题 | 校验标题、正文、话题均已写入 |
| 7 | `07-cover` | 选择视频首帧封面 | 选择首帧作为封面 | `checkCoverSelected` 校验封面已选 |
| 8 | `08-self-declaration` | 设置自主声明 | 选择 AI 内容或无需声明 | `checkSelfDeclarationSet` 校验声明项符合预期 |
| 9 | `09-publish` | 点击发布按钮 | 点击发布按钮，处理自主声明确认；如果出现短信验证码则交给下一步处理 | 无独立校验 |
| 10 | `10-sms-verification` | 处理短信验证码 | 触发获取验证码、通知接收验证码、轮询 OTP、回填验证码 | `checkPublishSmsVerificationCompleted` 校验短信弹窗已关闭 |
| 11 | `11-publish-submit-check` | 校验发布提交结果 | 无动作 | `checkPublishSubmitted` 校验已进入作品管理页、出现成功提示，或发布表单已离开 |
| 12 | `12-post-wait` | 发布后停留 | 按 `publishWaitSec` 等待 | 无独立校验 |

如果未配置 `scheduleAt`，第 4 步会改为：

| 序号 | tag | 状态 |
| --- | --- | --- |
| 4 | `04-schedule-skipped` | `skipped`，原因：未配置 `scheduleAt` |

如果 `publishEnabled=false`，第 9 步会改为：

| 序号 | tag | 状态 |
| --- | --- | --- |
| 9 | `09-publish-skipped` | `skipped`，原因：`publishEnabled=false` |

如果未出现短信验证码弹窗，第 10 步会改为：

| 序号 | tag | 状态 |
| --- | --- | --- |
| 10 | `10-sms-verification-skipped` | `skipped`，原因：未出现短信验证码弹窗 |

## 视频不挂车流程

视频不挂车与视频挂车流程基本一致，区别在第 5 步。

| 序号 | tag | 步骤 | action | verify |
| --- | --- | --- | --- | --- |
| 5 | `05-product-link-absent` | 购物车商品链接（跳过，未配置） | 无动作 | `checkProductLinkAbsent` 校验页面未选中购物车、没有商品卡片、没有商品链接残留、商品弹窗未打开 |

其他步骤与视频挂车流程相同。

## 图文挂车流程

| 序号 | tag | 步骤 | action | verify |
| --- | --- | --- | --- | --- |
| 1 | `01-login` | 检查登录状态 | 检查账号登录态，必要时进入登录流程 | 动作内部完成登录确认 |
| 2 | `02-open-post-page` | 进入图文发布页 | 打开图文发布页并优化页面显示 | 等待上传入口出现 |
| 3 | `03-upload-images` | 上传图文素材 | 设置图片文件 | `checkImagesUploaded` 校验图片数量达到预期 |
| 4 | `04-schedule` | 校验并设置定时发布 | 设置定时发布时间 | `checkScheduleSet` 校验日期选择器有值 |
| 5 | `05-product-link` | 设置购物车商品链接 | 选择购物车，填写商品链接、商品短标题、审批文号并完成编辑 | `checkProductLinkSet` 校验购物车已选中、商品已添加、弹窗已关闭、商品标题匹配 |
| 6 | `06-title-description-topics` | 填写标题、正文与话题 | 填写标题、正文、话题 | 校验标题、正文、话题均已写入 |
| 7 | `07-self-declaration` | 设置自主声明 | 选择 AI 内容或无需声明 | `checkSelfDeclarationSet` 校验声明项符合预期 |
| 8 | `08-music` | 选择配乐 | 选择图文配乐 | `checkMusicSelected` 校验已选配乐或配乐占位消失 |
| 9 | `09-cover` | 处理封面设置 | 按配置选择封面并滚动到底部 | 无独立校验 |
| 10 | `10-publish` | 点击发布按钮 | 点击发布按钮，处理自主声明确认；如果出现短信验证码则交给下一步处理 | 无独立校验 |
| 11 | `11-sms-verification` | 处理短信验证码 | 触发获取验证码、通知接收验证码、轮询 OTP、回填验证码 | `checkPublishSmsVerificationCompleted` 校验短信弹窗已关闭 |
| 12 | `12-publish-submit-check` | 校验发布提交结果 | 无动作 | `checkPublishSubmitted` 校验已进入作品管理页、出现成功提示，或发布表单已离开 |
| 13 | `13-post-wait` | 发布后停留 | 按 `publishWaitSec` 等待 | 无独立校验 |

如果未配置 `scheduleAt`，第 4 步会改为：

| 序号 | tag | 状态 |
| --- | --- | --- |
| 4 | `04-schedule-skipped` | `skipped`，原因：未配置 `scheduleAt` |

如果 `publishEnabled=false`，第 10 步会改为：

| 序号 | tag | 状态 |
| --- | --- | --- |
| 10 | `10-publish-skipped` | `skipped`，原因：`publishEnabled=false` |

如果未出现短信验证码弹窗，第 11 步会改为：

| 序号 | tag | 状态 |
| --- | --- | --- |
| 11 | `11-sms-verification-skipped` | `skipped`，原因：未出现短信验证码弹窗 |

## 图文不挂车流程

图文不挂车与图文挂车流程基本一致，区别在第 5 步。

| 序号 | tag | 步骤 | action | verify |
| --- | --- | --- | --- | --- |
| 5 | `05-product-link-absent` | 购物车商品链接（跳过，未配置） | 无动作 | `checkProductLinkAbsent` 校验页面未选中购物车、没有商品卡片、没有商品链接残留、商品弹窗未打开 |

其他步骤与图文挂车流程相同。

## 发布按钮校验

发布后现在拆成三个步骤：

| 步骤 | 作用 |
| --- | --- |
| 点击发布按钮 | 只负责点击发布以及处理自主声明确认 |
| 处理短信验证码 | 只在短信验证码弹窗出现时执行；未出现则记录为 `skipped` |
| 校验发布提交结果 | 只观察最终页面状态，不再点击按钮 |

`checkPublishSubmitted` 不做点击动作，只观察页面状态。它会在发布按钮点击后判断：

| 判断项 | 结果 |
| --- | --- |
| URL 进入 `/content/manage` | 通过，认为已进入作品管理页 |
| 页面出现 `发布成功`、`提交成功`、`发布已提交` | 通过 |
| 页面出现 `发布失败`、`提交失败`、`系统异常`、`内容违规`、`操作失败` 等 | 失败，并记录错误文案 |
| 仍停留短信验证码弹窗 | 失败 |
| 仍在发布表单且发布按钮可见 | 持续等待，直到超时后失败 |
| 已离开发发布表单或发布按钮隐藏 | 通过，认为提交动作已完成 |

## 失败时可定位的信息

一次失败至少会留下：

| 文件 | 用途 |
| --- | --- |
| `<runId>/publish-step-state.json` | **本次运行**最后一步状态（重试后仍保留；任务级「最近一次」= runId 最大的子目录下该文件） |
| `<runId>/<flow>-steps.jsonl` | 本次运行完整步骤流水 |
| `<runId>/<flow>-step-<tag>-failed.png/.yml` | 某一步失败时的截图与页面结构（主排查文件） |
| `<runId>/run-failed.png/.yml` | 仅当失败发生在步骤外且步骤未存快照时的兜底 |

步骤失败时不会同时生成 `run-failed`，避免与 `*-step-*-failed` 重复。

如果步骤超时，还会在 `<runId>/` 下保存带 `timeout` 的截图和 YAML。

可选环境变量：

- `CREATOR_PUBLISH_DEBUG_SAVE_HTML=true`：额外保存完整 HTML（默认不保存，体积过大）
- `CREATOR_PUBLISH_DEBUG_TZ`：debug 目录与步骤日志使用的时区（默认 `Asia/Shanghai`）
- `CREATOR_PUBLISH_DEBUG_SNAPSHOT_DEPTH=<N>`：限制 aria snapshot 深度，页面过大时可缩小输出
