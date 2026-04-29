"use client";

import { Form, Input } from "antd";

interface FeishuData {
  shop: { baseUrl?: string; appToken: string; tableId: string; keepRows?: number };
  creator: { baseUrl?: string; appToken: string; tableId: string };
}

interface Props extends FeishuData {
  onChange: (data: FeishuData) => void;
}

export default function ConfigFeishuTab({ shop, creator, onChange }: Props) {
  function update(section: "shop" | "creator", field: string, value: any) {
    const data: FeishuData = { shop, creator };
    if (section === "shop") data.shop = { ...data.shop, [field]: value };
    else data.creator = { ...data.creator, [field]: value };
    onChange(data);
  }

  return (
    <div>
      <h3>抖店多维表格</h3>
      <Form layout="vertical">
        <Form.Item label="Base URL">
          <Input
            value={shop.baseUrl || ""}
            onChange={(e) => update("shop", "baseUrl", e.target.value)}
            placeholder="飞书多维表格完整链接（可选）"
          />
        </Form.Item>
        <Form.Item label="App Token" required>
          <Input
            value={shop.appToken}
            onChange={(e) => update("shop", "appToken", e.target.value)}
            placeholder="飞书多维表格 App Token"
          />
        </Form.Item>
        <Form.Item label="Table ID" required>
          <Input
            value={shop.tableId}
            onChange={(e) => update("shop", "tableId", e.target.value)}
            placeholder="数据表 ID"
          />
        </Form.Item>

        <Form.Item label="覆盖写入时保留前 N 行">
          <Input
            inputMode="numeric"
            value={String(shop.keepRows ?? 0)}
            onChange={(e) => {
              const n = Math.max(0, Math.floor(Number(e.target.value)) || 0);
              update("shop", "keepRows", n);
            }}
            placeholder="0 表示不保留"
          />
        </Form.Item>
      </Form>

      <h3 style={{ marginTop: 16 }}>抖创多维表格</h3>
      <Form layout="vertical">
        <Form.Item label="Base URL">
          <Input
            value={creator.baseUrl || ""}
            onChange={(e) => update("creator","baseUrl", e.target.value)}
            placeholder="飞书多维表格完整链接（可选）"
          />
        </Form.Item>
        <Form.Item label="App Token" required>
          <Input
            value={creator.appToken}
            onChange={(e) => update("creator","appToken", e.target.value)}
            placeholder="飞书多维表格 App Token"
          />
        </Form.Item>
        <Form.Item label="Table ID" required>
          <Input
            value={creator.tableId}
            onChange={(e) => update("creator","tableId", e.target.value)}
            placeholder="数据表 ID"
          />
        </Form.Item>
      </Form>
    </div>
  );
}
