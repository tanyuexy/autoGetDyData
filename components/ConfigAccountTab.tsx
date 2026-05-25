"use client";

import { Tag, Input, Space, Button, App } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useState } from "react";

interface Props {
  accounts: string[];
  onChange: (data: { accounts: string[] }) => void;
}

export default function ConfigAccountTab({
  accounts: initialAccounts,
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
    onChange({ accounts: next });
  }

  function removeAccount(name: string) {
    const next = accounts.filter((a) => a !== name);
    setAccounts(next);
    onChange({ accounts: next });
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
    </Space>
  );
}
