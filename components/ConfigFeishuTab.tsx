"use client";

import { useMemo } from "react";
import { Form, Input, Typography } from "antd";
import { parseFeishuBitableUrl } from "@/lib/feishu/parse-bitable-url";

interface FeishuData {
  shop: { baseUrl?: string; appToken: string; tableId: string };
  creator: { baseUrl?: string; appToken: string; tableId: string; keepRows?: number };
  task: { baseUrl?: string; appToken: string; tableId: string };
  product: { baseUrl?: string; appToken: string; tableId: string };
  shopInfo: { baseUrl?: string; appToken: string; tableId: string };
}

interface Props extends FeishuData {
  onChange: (data: FeishuData) => void;
}

type SectionKey = "shop" | "creator" | "task" | "product" | "shopInfo";

function BitableUrlField({
  baseUrl,
  onChange,
}: {
  baseUrl: string;
  onChange: (url: string) => void;
}) {
  const parsed = useMemo(() => parseFeishuBitableUrl(baseUrl), [baseUrl]);
  const trimmed = baseUrl.trim();

  return (
    <>
      <Form.Item label="Base URL" required>
        <Input
          value={baseUrl}
          onChange={(e) => onChange(e.target.value)}
          placeholder="粘贴飞书多维表格链接，如 https://xxx.feishu.cn/base/<appToken>?table=<tableId>"
        />
      </Form.Item>
      {trimmed && (
        <Form.Item>
          {parsed ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              已识别 · App Token: <code>{parsed.appToken}</code> · Table ID:{" "}
              <code>{parsed.tableId}</code>
              {parsed.viewId ? ` · 视图: ${parsed.viewId}` : ""}
            </Typography.Text>
          ) : (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              链接格式无法识别，需包含 /base/&lt;appToken&gt; 与 ?table=&lt;tableId&gt;
            </Typography.Text>
          )}
        </Form.Item>
      )}
    </>
  );
}

export default function ConfigFeishuTab({
  shop,
  creator,
  task,
  product,
  shopInfo,
  onChange,
}: Props) {
  function update(section: SectionKey, patch: Record<string, unknown>) {
    const data: FeishuData = { shop, creator, task, product, shopInfo };
    if (section === "shop") data.shop = { ...data.shop, ...patch } as FeishuData["shop"];
    else if (section === "creator")
      data.creator = { ...data.creator, ...patch } as FeishuData["creator"];
    else if (section === "task") data.task = { ...data.task, ...patch } as FeishuData["task"];
    else if (section === "product")
      data.product = { ...data.product, ...patch } as FeishuData["product"];
    else data.shopInfo = { ...data.shopInfo, ...patch } as FeishuData["shopInfo"];
    onChange(data);
  }

  function updateBaseUrl(section: SectionKey, url: string) {
    const parsed = parseFeishuBitableUrl(url);
    update(section, {
      baseUrl: url,
      ...(parsed ? { appToken: parsed.appToken, tableId: parsed.tableId } : {}),
    });
  }

  return (
    <div>
      <h3>抖店多维表格</h3>
      <Form layout="vertical">
        <BitableUrlField
          baseUrl={shop.baseUrl || ""}
          onChange={(url) => updateBaseUrl("shop", url)}
        />
      </Form>

      <h3 style={{ marginTop: 16 }}>抖创多维表格</h3>
      <Form layout="vertical">
        <BitableUrlField
          baseUrl={creator.baseUrl || ""}
          onChange={(url) => updateBaseUrl("creator", url)}
        />
        <Form.Item label="覆盖写入时保留前 N 行">
          <Input
            inputMode="numeric"
            value={String(creator.keepRows ?? 0)}
            onChange={(e) => {
              const n = Math.max(0, Math.floor(Number(e.target.value)) || 0);
              update("creator", { keepRows: n });
            }}
            placeholder="0 表示不保留"
          />
        </Form.Item>
      </Form>

      <h3 style={{ marginTop: 16 }}>任务多维表格</h3>
      <Form layout="vertical">
        <BitableUrlField
          baseUrl={task.baseUrl || ""}
          onChange={(url) => updateBaseUrl("task", url)}
        />
      </Form>

      <h3 style={{ marginTop: 16 }}>商品信息多维表格</h3>
      <Form layout="vertical">
        <BitableUrlField
          baseUrl={product.baseUrl || ""}
          onChange={(url) => updateBaseUrl("product", url)}
        />
      </Form>

      <h3 style={{ marginTop: 16 }}>店铺信息多维表格</h3>
      <Form layout="vertical">
        <BitableUrlField
          baseUrl={shopInfo.baseUrl || ""}
          onChange={(url) => updateBaseUrl("shopInfo", url)}
        />
      </Form>
    </div>
  );
}
