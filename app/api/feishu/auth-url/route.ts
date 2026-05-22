import { NextResponse } from "next/server";
import { loadFeishuConfig } from "@/lib/feishu/core/config";
import { buildAuthorizeUrl } from "@/lib/feishu/core/oauth";

export async function POST() {
  try {
    const config = loadFeishuConfig();
    if (!config.redirectUri) {
      return NextResponse.json(
        {
          error:
            "缺少 FEISHU_OAUTH_REDIRECT_URI。请在 .env 中配置，例如：http://localhost:3000/api/feishu/callback"
        },
        { status: 500 }
      );
    }

    const url = buildAuthorizeUrl(config);
    return NextResponse.json({ url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
