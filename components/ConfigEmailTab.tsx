"use client";

import { Table, Button, Space, Modal, Form, Input, Popconfirm, App } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useState } from "react";

interface EmailEntry {
  email: string;
  password: string;
}

interface Props {
  emails: EmailEntry[];
  onChange: (emails: EmailEntry[]) => void;
}

export default function ConfigEmailTab({ emails: initial, onChange }: Props) {
  const { message } = App.useApp();
  const [emails, setEmails] = useState<EmailEntry[]>(initial || []);
  const [modalOpen, setModalOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [form] = Form.useForm();

  function openAdd() {
    setEditIndex(null);
    form.resetFields();
    setModalOpen(true);
  }

  function openEdit(index: number) {
    setEditIndex(index);
    form.setFieldsValue(emails[index]);
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
      title: "密码",
      dataIndex: "password",
      key: "password",
      render: () => "********",
    },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_: any, __: any, index: number) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(index)}
          />
          <Popconfirm
            title="确认删除？"
            onConfirm={() => handleDelete(index)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={openAdd}
        style={{ marginBottom: 12 }}
      >
        添加邮箱
      </Button>
      <Table
        columns={columns}
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
