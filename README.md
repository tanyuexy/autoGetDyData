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

### 企业微信推送与验证码回复

抖创登录验证支持“企业微信推送 + 公网 OTP 中转页 / `mailto:` 验证码回复”：

- 企业微信 webhook 只负责推送通知，不负责接收回复。
- 当前通知策略为：**企业微信优先，邮箱兜底**。
- 如果企业微信发送成功，则不再发送邮箱提醒。
- 如果企业微信未配置或发送失败，则自动回退到原邮箱提醒。
- “接收短信验证码”阶段优先推送一个公网 OTP 中转页链接；用户可直接打开页面填写验证码提交。
- 如果未配置中转页，则回退为 `mailto:` 链接 + 邮件回复；后台仍通过 IMAP 轮询验证码收件箱，提取 4-8 位数字验证码并自动回填。
- 当前项目会通过 HTTP 轮询公网 OTP 中转服务，再回退读取 IMAP 邮箱。
- 邮箱提醒链路保留，仅作为企业微信不可用时的兜底。

常用环境变量：

```bash
WECOM_NOTIFY_ENABLED=true
WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx
WECOM_MENTION_USERS=userid1,userid2
WECOM_MENTION_MOBILES=13800000000

OTP_REPLY_TO=your-otp-inbox@example.com
OTP_REPLY_SUBJECT_PREFIX=[抖音验证码回复]
OTP_IMAP_HOST=imap.example.com
OTP_IMAP_USER=your-otp-inbox@example.com
OTP_IMAP_PASS=xxxx
OTP_BRIDGE_BASE_URL=https://your-otp-bridge.example.com
OTP_BRIDGE_ACCESS_TOKEN=optional-token
OTP_BRIDGE_TIMEOUT_MS=5000
```

说明：

- `WECOM_WEBHOOK_URL` 只要配置了，默认就会启用企业微信推送。
- `WECOM_NOTIFY_ENABLED` 可选；需要显式关闭时可设为 `false`。
- `OTP_REPLY_TO` 可选；未配置时会默认回退到 `OTP_IMAP_USER` 作为 `mailto:` 收件人。
- `OTP_BRIDGE_BASE_URL` 配置后，企业微信会优先推送一个公网验证码填写页链接。
- 可将 `services/otp-bridge-public/` 单独拷贝到公网服务器，用 `pm2 start npm --name otp-bridge-public -- start` 部署。

注意：`WECOM_WEBHOOK_URL`、`OTP_IMAP_PASS`、`SMTP_PASS` 都是敏感信息，不能提交到仓库。

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
