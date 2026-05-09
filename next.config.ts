import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
