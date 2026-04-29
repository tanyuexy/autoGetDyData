"use client";

import { Tag, Input, Select, Space, Button, Form, App } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useState } from "react";

interface Props {
  accounts: string[];
  loginVerifyMethod: string;
  onChange: (data: { accounts: string[]; loginVerifyMethod: string }) => void;
}

export default function ConfigAccountTab({
  accounts: initialAccounts,
  loginVerifyMethod,
  onChange,
}: Props) {
  const { message } = App.useApp();
  const [accounts, setAccounts] = useState<string[]>(initialAccounts || []);
  const [input, setInput] = useState("");

  function addAccount() {
    const name = input.trim();
    if (!name) return;
    if (accounts.includes(name)) {
      message.warning("账号已存在");
      return;
    }
    const next = [...accounts, name];
    setAccounts(next);
    setInput("");
    onChange({ accounts: next, loginVerifyMethod });
  }

  function removeAccount(name: string) {
    const next = accounts.filter((a) => a !== name);
    setAccounts(next);
    onChange({ accounts: next, loginVerifyMethod });
  }

  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
      <div>
        <Space.Compact style={{ width: 400 }}>
          <Input
            placeholder="输入账号名称（店铺名）"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={addAccount}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={addAccount}>
            添加
          </Button>
        </Space.Compact>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {accounts.map((name) => (
          <Tag key={name} closable onClose={() => removeAccount(name)}>
            {name}
          </Tag>
        ))}
        {accounts.length === 0 && (
          <span style={{ color: "#999" }}>暂无账号，请添加</span>
        )}
      </div>

      <Form.Item label="登录验证方式" style={{ maxWidth: 400 }}>
        <Select
          value={loginVerifyMethod || "qr"}
          onChange={(v) => onChange({ accounts, loginVerifyMethod: v })}
          options={[
            { value: "qr", label: "扫码登录 (qr)" },
            { value: "sms", label: "短信验证 (sms)" },
            {
              value: "receive_sms_code",
              label: "接收短信验证码 (receive_sms_code)",
            },
          ]}
        />
      </Form.Item>
    </Space>
  );
}
