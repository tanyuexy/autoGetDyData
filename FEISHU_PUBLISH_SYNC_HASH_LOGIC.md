# 飞书发布任务同步与 Hash 判断逻辑

本文档记录 `lib/feishu/sync-publish-tasks.ts` 中，飞书发布任务导入/刷新本地任务时的判断逻辑。

## 1. 前置同步条件

每次导入或刷新飞书任务时，先读取飞书任务表记录。

只有满足以下条件的记录，才会进入后续同步判断：

```text
审批 = 通过
备注 != 示例
所属店铺 有值
视频/图文内容 有附件
```

不满足这些条件的记录会直接跳过。

日志会输出同步规则和跳过统计，例如：

```text
同步规则：仅处理「审批=通过」且非示例、已填所属店铺、已上传视频/图文内容的记录；刷新任务同样只更新符合该规则的记录
其中 47 条满足同步条件
已跳过 21 条：审批不是通过(异常待修改) 1 条，审批不是通过(待审批) 3 条，缺少视频/图文内容 2 条
```

## 2. 候选记录的短路跳过

记录通过前置条件后，会先做不需要 hash 的短路判断：

```text
本地任务 status = running
-> 跳过，不更新

飞书「已创建任务」= 是
-> 跳过，不更新

本地不存在该任务，且飞书「已创建任务」不是空/否
-> 跳过，不新建
```

这些判断通过后，才会计算 hash。

## 3. 两种 Hash

### 飞书完整 Hash

函数：`buildFeishuContentHash(snapshot)`

来源：飞书当前行快照。

包含字段：

```text
所属店铺
任务类型 video/article
标题
正文
AI内容
计划发布时间 scheduleAt
挂车链接
挂车产品名
附件信息：file_token / 文件名 / 类型 / 大小
```

用途：

```text
判断飞书行本身是否变化，尤其是附件是否变化。
```

本地 Mongo 中的 `feishuContentHash` 存的是这个飞书完整 hash。

### 本地核心 Payload Hash

函数：`buildCoreContentHash(buildTaskComparableInput(existingTask))`

来源：本地 Mongo 中已保存的任务 payload。

包含字段：

```text
所属店铺
任务类型 video/article
标题
正文
AI内容
计划发布时间 scheduleAt
挂车链接
挂车产品名
```

不包含附件 file_token / size / type，因为本地 payload 只保存下载后的 `videoFileKey` / `imagesFileKeys`，无法和飞书原始附件信息一一等价比较。

用途：

```text
判断本地 payload 是否和飞书当前核心内容一致。
```

## 4. 判断分支

对于已存在的本地任务：

```text
飞书核心 hash = 本地核心 payload hash
并且
飞书完整 hash = 本地 feishuContentHash
-> 无变化，跳过
```

```text
飞书核心 hash = 本地核心 payload hash
但
飞书完整 hash != 本地 feishuContentHash
-> 只补/更新 feishuContentHash，不重置任务内容
```

```text
飞书核心 hash != 本地核心 payload hash
-> 认为本地 payload 与飞书不一致，更新本地任务，并重置为 pending
```

对于本地不存在的任务：

```text
allowCreate = true
并且飞书「已创建任务」为空或否
-> 新建本地任务
```

## 5. 为什么要两边都重新算

旧逻辑只重新计算飞书完整 hash，然后和本地保存的 `feishuContentHash` 比较：

```text
飞书当前 hash == 本地保存的 feishuContentHash
-> 认为无变化
```

这会有一个风险：

```text
如果历史导入时本地 payload 保存不完整，
但 feishuContentHash 已经保存成了飞书正确内容的 hash，
后续只要飞书不变，就会一直跳过，
本地脏 payload 不会被修复。
```

现在新增本地核心 payload hash 对比后，可以识别：

```text
飞书没变，但本地 payload 和飞书核心内容不一致
-> 更新本地任务
```

同时仍然保留前置规则：

```text
审批不通过、示例、缺店铺、缺素材、已创建任务=是、running
-> 不算 hash，直接跳过
```
