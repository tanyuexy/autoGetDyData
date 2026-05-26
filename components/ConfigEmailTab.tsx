"use client";

import { Table, Button, Space, Modal, Form, Input, Popconfirm, App, Tag, Tooltip } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, SafetyCertificateOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import type { ShopAccount } from "@/types";
import { semanticTagStyle } from "@/lib/semanticTagStyles";

interface EmailEntry {
  email: string;
  password: string;
}

interface Props {
  emails: EmailEntry[];
  onChange: (emails: EmailEntry[]) => void;
  onLogin?: (email: string) => void;
  onOpenShop?: (email: string) => void;
  refreshKey?: number;
}

function formatShortDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export default function ConfigEmailTab({ emails: initial, onChange, onLogin, onOpenShop, refreshKey = 0 }: Props) {
  const { message } = App.useApp();
  const [emails, setEmails] = useState<EmailEntry[]>(initial || []);
  const [accounts, setAccounts] = useState<ShopAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [verifying, setVerifying] = useState<Set<string>>(new Set());

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
  }, []);

  useEffect(() => {
    if (!refreshKey) return;
    refreshLoginStatus();
  }, [refreshKey]);

  async function handleVerify(email: string) {
    setVerifying((prev) => new Set(prev).add(email));
    try {
      const res = await fetch("/api/shop/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("验证请求失败");
      const result = await res.json();

      if (result.verified) {
        message.success(`账号 ${email} 验证通过 (${(result.elapsed / 1000).toFixed(1)}s)`);
      } else if (result.status === "warning") {
        message.warning(`账号 ${email} 验证不确定: ${result.detail}`);
      } else {
        message.warning(`账号 ${email} 验证失败: ${result.detail}`);
      }

      setAccounts((prev) =>
        prev.map((a) => {
          if (a.email === email) {
            return {
              ...a,
              cookieStatus: result.status || (result.verified ? "valid" : "expired"),
              cookieDetail: result.detail,
            };
          }
          return a;
        })
      );
      await refreshLoginStatus();
    } catch (e: any) {
      message.error(`验证失败: ${e.message || e}`);
    }
    setVerifying((prev) => {
      const next = new Set(prev);
      next.delete(email);
      return next;
    });
  }

  const accountMap = useMemo(() => {
    const m = new Map<string, ShopAccount>();
    for (const a of accounts) {
      m.set(String(a.email || "").trim(), a);
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

  function renderCookieTag(entry: EmailEntry) {
    const acc = accountMap.get(entry.email);
    if (!acc || !acc.hasStorageState) {
      return (
        <Tag icon={<CloseCircleOutlined />} style={semanticTagStyle("default")}>
          未登录
        </Tag>
      );
    }

    const status = acc.cookieStatus || "valid";

    if (status === "valid") {
      return (
        <Tooltip title={acc.cookieDetail || "登录态有效"}>
          <Tag icon={<CheckCircleOutlined />} style={semanticTagStyle("success")}>
            有效
          </Tag>
        </Tooltip>
      );
    }

    if (status === "warning") {
      return (
        <Tooltip title={acc.cookieDetail || "登录态可能过期"}>
          <Tag icon={<ExclamationCircleOutlined />} style={semanticTagStyle("warning")}>
            可能过期
          </Tag>
        </Tooltip>
      );
    }

    if (status === "expired") {
      return (
        <Tooltip title={acc.cookieDetail || "登录态已过期"}>
          <Tag icon={<CloseCircleOutlined />} style={semanticTagStyle("error")}>
            已过期
          </Tag>
        </Tooltip>
      );
    }

    return (
      <Tooltip title={acc.cookieDetail || "未知状态"}>
        <Tag icon={<QuestionCircleOutlined />} style={semanticTagStyle("default")}>
          未知
        </Tag>
      </Tooltip>
    );
  }

  const columns = [
    { title: "邮箱", dataIndex: "email", key: "email", align: "center" as const },
    {
      title: "登录态",
      dataIndex: "hasStorageState",
      key: "hasStorageState",
      width: 110,
      align: "center" as const,
      render: (_: any, row: EmailEntry) => renderCookieTag(row),
    },
    {
      title: "最后登录",
      dataIndex: "lastLoginAt",
      key: "lastLoginAt",
      width: 130,
      align: "center" as const,
      render: (_: any, row: EmailEntry) => {
        const acc = accountMap.get(row.email);
        return formatShortDateTime(acc?.lastLoginAt);
      },
    },
    {
      title: "密码",
      dataIndex: "password",
      key: "password",
      align: "center" as const,
      render: () => "********",
    },
    {
      title: "操作",
      key: "actions",
      width: 360,
      align: "center" as const,
      render: (_: any, row: EmailEntry, index: number) => {
        const acc = accountMap.get(row.email);
        const hasState = acc?.hasStorageState;
        const isVerifying = verifying.has(row.email);
        const canOpenShop = !!hasState;

        return (
          <Space wrap style={{ width: "100%", justifyContent: "center" }}>
            {onLogin && (
              <Button
                size="small"
                type="primary"
                disabled={!!hasState && acc?.cookieStatus === "valid"}
                onClick={() => onLogin(row.email)}
              >
                登录
              </Button>
            )}
            {onOpenShop && (
              <Tooltip title={canOpenShop ? "使用该账号会话打开抖店页面" : "尚未登录，无法打开抖店页面"}>
                <span>
                  <Button
                    size="small"
                    disabled={!canOpenShop}
                    onClick={() => onOpenShop(row.email)}
                  >
                    抖店页面
                  </Button>
                </span>
              </Tooltip>
            )}
            {hasState && (
              <Button
                size="small"
                icon={<SafetyCertificateOutlined />}
                loading={isVerifying}
                onClick={() => handleVerify(row.email)}
              >
                验证
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
        );
      },
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
        styles={{
          header: { cell: { textAlign: "center" } },
          body: { cell: { textAlign: "center" } },
        }}
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
