import { NextResponse } from "next/server";

export async function POST() {
  try {
    const { loadFeishuConfig } = require("@/lib/feishu/core/config");
    const { buildAuthorizeUrl } = require("@/lib/feishu/core/oauth");

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
