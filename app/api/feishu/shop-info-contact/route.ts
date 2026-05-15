import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/configService";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const shopName = String(body?.shopName || "").trim();
    if (!shopName) {
      return NextResponse.json({ error: "缺少 shopName" }, { status: 400 });
    }

    const appConfig = await getConfig();
    const shopInfo = appConfig.feishu?.shopInfo;
    if (!shopInfo?.appToken || !shopInfo?.tableId) {
      return NextResponse.json({ found: false, error: "未配置 feishu.shopInfo" });
    }

    const { loadFeishuConfig } = require("@/lib/feishu/core/config");
    const { getValidAccessToken } = require("@/lib/feishu/core/oauth");
    const { listAllBitableRecords } = require("@/lib/feishu/core/bitable");

    const feishuCfg = {
      ...loadFeishuConfig(),
      bitableAppToken: shopInfo.appToken,
      bitableTableId: shopInfo.tableId,
    };
    const tokenCache = await getValidAccessToken(feishuCfg);
    const records = await listAllBitableRecords(feishuCfg, tokenCache.accessToken, "", [
      "店铺名",
      "招码人",
      "电话",
    ]);

    for (const record of records || []) {
      const fields = record?.fields || {};
      const recordShopName = String(fields["店铺名"] || "").trim();
      if (recordShopName !== shopName) continue;

      const recruiter = String(fields["招码人"] || "").trim();
      const phone = String(fields["电话"] || "").replace(/\D+/g, "").trim();
      return NextResponse.json({
        found: Boolean(phone),
        shopName: recordShopName,
        recruiter,
        phone,
      });
    }

    return NextResponse.json({ found: false, shopName });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "读取店铺信息失败" }, { status: 500 });
  }
}
