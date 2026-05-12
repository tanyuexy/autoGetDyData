import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 通过局域网 IP / 非 localhost 访问 `next dev` 时，开发模式默认会拦截
  // `/_next/*` 与 HMR WebSocket；否则控制台会看到 webpack-hmr 连接失败。
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "172.16.114.186",
  ],
  // Allow importing CommonJS modules from scripts/
  transpilePackages: [],
  // Ensure Node.js built-ins work in API routes
  serverExternalPackages: [
    "playwright",
    "xlsx",
    "nodemailer",
    "imapflow",
    "mailparser",
    "dotenv",
  ],
  // Allow localhost-only access (this is a local tool)
  // Long-running API routes use export const maxDuration = 0
};

export default nextConfig;
