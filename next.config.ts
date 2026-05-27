import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 通过局域网 IP 访问 `next dev` 时需放行 dev/HMR；Next.js 不支持单独 "*"
  allowedDevOrigins: ["*.*.*.*"],
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
    "@ffmpeg-installer/ffmpeg",
  ],
  // Allow localhost-only access (this is a local tool)
  // Long-running API routes use export const maxDuration = 0
};

export default nextConfig;
