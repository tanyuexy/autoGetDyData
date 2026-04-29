"use client";

import { Form, Input } from "antd";

interface FeishuData {
  shop: { baseUrl?: string; appToken: string; tableId: string };
  creator: { baseUrl?: string; appToken: string; tableId: string };
  worksStripCopy: {
    appToken: string;
    sourceTableId: string;
    targetTableId: string;
    titleFieldName: string;
  };
}

interface Props extends FeishuData {
  onChange: (data: FeishuData) => void;
}

export default function ConfigFeishuTab({
  shop,
  creator,
  worksStripCopy,
  onChange,
}: Props) {
  function update(section: string, field: string, value: string) {
    const data: FeishuData = { shop, creator, worksStripCopy };
    if (section === "shop") data.shop = { ...data.shop, [field]: value };
    else if (section === "creator")
      data.creator = { ...data.creator, [field]: value };
    else if (section === "worksStripCopy")
      data.worksStripCopy = { ...data.worksStripCopy, [field]: value };
    onChange(data);
  }

  return (
    <div>
      <h3>抖店多维表格</h3>
      <Form layout="vertical">
        <Form.Item label="Base URL">
          <Input
            value={shop.baseUrl || ""}
            onChange={(e) => update("shop","baseUrl", e.target.value)}
            placeholder="飞书多维表格完整链接（可选）"
          />
        </Form.Item>
        <Form.Item label="App Token" required>
          <Input
            value={shop.appToken}
            onChange={(e) => update("shop","appToken", e.target.value)}
            placeholder="飞书多维表格 App Token"
          />
        </Form.Item>
        <Form.Item label="Table ID" required>
          <Input
            value={shop.tableId}
            onChange={(e) => update("shop","tableId", e.target.value)}
            placeholder="数据表 ID"
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

      <h3 style={{ marginTop: 16 }}>作品表复制（去空格）</h3>
      <Form layout="vertical">
        <Form.Item label="App Token" required>
          <Input
            value={worksStripCopy.appToken}
            onChange={(e) =>
              update("worksStripCopy","appToken", e.target.value)
            }
          />
        </Form.Item>
        <Form.Item label="源表 ID">
          <Input
            value={worksStripCopy.sourceTableId}
            onChange={(e) =>
              update("worksStripCopy","sourceTableId", e.target.value)
            }
          />
        </Form.Item>
        <Form.Item label="目标表 ID">
          <Input
            value={worksStripCopy.targetTableId}
            onChange={(e) =>
              update("worksStripCopy","targetTableId", e.target.value)
            }
          />
        </Form.Item>
        <Form.Item label="标题字段名">
          <Input
            value={worksStripCopy.titleFieldName}
            onChange={(e) =>
              update("worksStripCopy","titleFieldName", e.target.value)
            }
          />
        </Form.Item>
      </Form>
    </div>
  );
}
