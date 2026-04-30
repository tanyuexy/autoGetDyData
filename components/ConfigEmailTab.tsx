"use client";

import { Table, Button, Space, Modal, Form, Input, Popconfirm, App, Tag } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import type { ShopAccount } from "@/types";

interface EmailEntry {
  email: string;
  password: string;
}

interface Props {
  emails: EmailEntry[];
  onChange: (emails: EmailEntry[]) => void;
  onLogin?: (email: string) => void;
}

export default function ConfigEmailTab({ emails: initial, onChange, onLogin }: Props) {
  const { message } = App.useApp();
  const [emails, setEmails] = useState<EmailEntry[]>(initial || []);
  const [accounts, setAccounts] = useState<ShopAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!modalOpen) return;
    Promise.resolve().then(() => {
      if (editIndex !== null && emails[editIndex]) {
        form.setFieldsValue(emails[editIndex]);
      } else {
        form.resetFields();
      }
    });
  }, [modalOpen, editIndex, emails, form]);

  useEffect(() => {
    setEmails(initial || []);
  }, [initial]);

  async function refreshLoginStatus() {
    setAccountsLoading(true);
    try {
      const res = await fetch("/api/shop/list", { cache: "no-store" });
      if (!res.ok) throw new Error("获取登录态失败");
      const data = await res.json();
      setAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
    } catch (e: any) {
      message.error(e.message || "获取登录态失败");
    }
    setAccountsLoading(false);
  }

  useEffect(() => {
    refreshLoginStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasStorageByEmail = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const a of accounts) {
      m.set(String(a.email || "").trim(), !!a.hasStorageState);
    }
    return m;
  }, [accounts]);

  function openAdd() {
    setEditIndex(null);
    setModalOpen(true);
  }

  function openEdit(index: number) {
    setEditIndex(index);
    setModalOpen(true);
  }

  function handleOk() {
    form.validateFields().then((values) => {
      const entry = { email: values.email.trim(), password: values.password };
      let next: EmailEntry[];
      if (editIndex !== null) {
        next = [...emails];
        next[editIndex] = entry;
      } else {
        if (emails.some((e) => e.email === entry.email)) {
          message.warning("邮箱已存在");
          return;
        }
        next = [...emails, entry];
      }
      setEmails(next);
      onChange(next);
      setModalOpen(false);
    });
  }

  function handleDelete(index: number) {
    const next = emails.filter((_, i) => i !== index);
    setEmails(next);
    onChange(next);
  }

  const columns = [
    { title: "邮箱", dataIndex: "email", key: "email" },
    {
      title: "登录态",
      dataIndex: "hasStorageState",
      key: "hasStorageState",
      width: 100,
      render: (_: any, row: EmailEntry) =>
        hasStorageByEmail.get(row.email) ? (
          <Tag color="success">有效</Tag>
        ) : (
          <Tag>未登录</Tag>
        ),
    },
    {
      title: "密码",
      dataIndex: "password",
      key: "password",
      render: () => "********",
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_: any, row: EmailEntry, index: number) => (
        <Space>
          {onLogin && (
            <Button
              size="small"
              type="primary"
              disabled={!!hasStorageByEmail.get(row.email)}
              onClick={() => onLogin(row.email)}
            >
              登录
            </Button>
          )}
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(index)}
          />
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(index)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          添加邮箱
        </Button>
        <Button icon={<ReloadOutlined />} onClick={refreshLoginStatus} loading={accountsLoading}>
          刷新登录态
        </Button>
      </Space>

      <Table
        columns={columns as any}
        dataSource={emails.map((e, i) => ({ ...e, key: String(i) }))}
        pagination={false}
        size="small"
        locale={{ emptyText: "暂无邮箱账号" }}
      />
      <Modal
        title={editIndex !== null ? "编辑邮箱" : "添加邮箱"}
        open={modalOpen}
        onOk={handleOk}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: "请输入邮箱" },
              { type: "email", message: "邮箱格式不正确" },
            ]}
          >
            <Input placeholder="example@163.com" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
