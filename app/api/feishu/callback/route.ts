import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { loadFeishuConfig } = require("@/lib/feishu/core/config");
    const { exchangeCodeForToken, writeTokenCache } = require("@/lib/feishu/core/oauth");

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code) {
      return new NextResponse(
        '<html><body><h2>授权失败</h2><p>未收到授权码 (code)</p></body></html>',
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    const config = loadFeishuConfig();
    const tokenRecord = await exchangeCodeForToken(config, code);
    await writeTokenCache(config.tokenCachePath, tokenRecord);

    return new NextResponse(
      `<html>
        <head>
          <meta charset="utf-8" />
          <title>授权成功</title>
        </head>
        <body style="font-family:sans-serif;text-align:center;padding-top:80px;">
          <h2 style="color:green;">飞书授权成功</h2>
          <p>Token 已保存，页面将在 <span id="sec">3</span>s 后自动关闭</p>
          <script>
            (function () {
              var sec = 3;
              var el = document.getElementById('sec');
              function tick() {
                sec -= 1;
                if (el) el.textContent = String(sec);
                if (sec <= 0) {
                  try { window.close(); } catch (e) {}
                  setTimeout(function () {
                    document.body.insertAdjacentHTML('beforeend', '<p style="color:#999;margin-top:16px;">若未自动关闭，请手动关闭此标签页</p>');
                  }, 200);
                  return;
                }
                setTimeout(tick, 1000);
              }
              setTimeout(tick, 1000);
              setTimeout(function () {
                try { window.close(); } catch (e) {}
              }, 3000);
            })();
          </script>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (e: any) {
    return new NextResponse(
      `<html><body><h2>授权失败</h2><p>${e.message}</p></body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}
