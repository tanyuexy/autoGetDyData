# autoGetDyData

用于管理抖创数据、抖店数据、作品审核、评论抓取、定时发布和飞书同步的内部工具。

## 常用命令

```bash
npm run dev
npm run dev:all
npm run build
npm run start
npm run worker
npm run worker:dev
npx tsc --noEmit
```

## 开发约束

### 不要使用已弃用的属性或方法

项目使用 `antd v6`。开发或改动组件时，先确认当前属性 / API 是否已弃用；如果控制台出现 deprecation warning，需要顺手修掉，不要把已知弃用写法继续留在代码里。

当前已知需要避免的写法：

- `InputNumber` 的 `addonBefore` / `addonAfter`
  改用 `Space.Compact` + `Button`
- `Modal` 的 `destroyOnClose`
  改用 `destroyOnHidden`
- `Space` 的 `direction`
  改用 `orientation`
- `Tag` 的 `bordered={false}`（antd v6）
  改用 `variant="filled"`

### 关于 `Tag` 和 `Table` 的特别说明

不要把 `Tag` 的替代方案误套到 `Table` 上：

- `Tag`：`bordered={false}` 已弃用，使用 `variant="filled"`
- `Table`：仍然使用 `bordered={false}` 控制是否显示表格边框
- `Table` 没有和 `Tag` 对应的 `variant` 用法

## 说明

更完整的仓库约束、脚本路由、任务架构和账号自动化说明见 `CLAUDE.md`。
