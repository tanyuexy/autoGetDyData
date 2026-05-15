# otp-bridge-public

公网验证码中转服务，给当前项目的抖音验证码流程提供一个可直接打开的填写页。

当前版本只支持：

- `requestId` 会话模式，避免同账号提前提交/串单

## 启动

```bash
npm install
npm start
```

配合 `pm2`：

```bash
pm2 start npm --name otp-bridge-public -- start
```

## 环境变量

```bash
OTP_BRIDGE_HOST=0.0.0.0
OTP_BRIDGE_PORT=8787
OTP_BRIDGE_PUBLIC_BASE_URL=https://your-domain.example.com
OTP_BRIDGE_ACCESS_TOKEN=your-token
OTP_BRIDGE_DATA_DIR=./data
OTP_BRIDGE_SESSION_TTL_MS=600000
```

说明：

- `OTP_BRIDGE_PUBLIC_BASE_URL` 用于返回公网可访问的 `entryUrl`
- `OTP_BRIDGE_ACCESS_TOKEN` 配置后，页面和 API 都需要带 `token`
- `OTP_BRIDGE_SESSION_TTL_MS` 默认 10 分钟

## 新接口

### 1. 创建验证码会话

`POST /api/session/create`

请求：

```json
{
  "accountName": "罗每乐官方旗舰店",
  "maskedPhone": "139****7171",
  "reason": "首次进入接收短信验证码阶段",
  "token": "your-token"
}
```

响应：

```json
{
  "requestId": "uuid",
  "entryUrl": "https://your-domain.example.com/?requestId=uuid&token=your-token",
  "expiresAt": 1747301100000,
  "ttlMs": 600000
}
```

### 2. 打开填写页

`GET /?requestId=uuid&token=your-token`

### 3. 提交验证码

`POST /submit`

表单字段：

- `requestId`
- `otpCode`
- `token`（如启用）

### 4. 读取并消费验证码

`GET /api/latest?requestId=uuid&token=your-token`

响应：

```json
{
  "otpCode": "123456",
  "checkedCount": 1,
  "matchedSubjectCount": 1,
  "source": "otp-bridge-session",
  "requestId": "uuid"
}
```

读取成功后会自动标记为 `consumed`，同一个 `requestId` 不会重复返回。

## 健康检查

`GET /api/health`
