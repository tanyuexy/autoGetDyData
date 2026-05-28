import type { NextRequest } from "next/server";

function getTrustedInternalApiToken(): string {
  return String(process.env.INTERNAL_API_TOKEN || process.env.APP_AUTH_SECRET || "").trim();
}

/** 供 proxy 使用，勿依赖 Node-only 模块 */
export function isInternalApiRequest(request: NextRequest): boolean {
  const token = getTrustedInternalApiToken();
  if (!token) return false;
  const header = request.headers.get("x-internal-api-token");
  return Boolean(header && header === token);
}
