"use client";

import {
  Table,
  Tag,
  Button,
  Dropdown,
  Space,
  Modal,
  Input,
  App,
  Tooltip,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  DownOutlined,
  PlusOutlined,
  ExclamationCircleOutlined,
  QuestionCircleOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import type { CreatorAccount, ShopAccount } from "@/types";
import { useState, useMemo, useEffect } from "react";
import { useTaskContext } from "@/contexts/TaskContext";

interface CreatorProps {
  type: "creator";
  accounts: CreatorAccount[];
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  onLogin?: (accountName: string, mode: "email_qr" | "local_manual") => void;
  onAddAccount?: (name: string) => void;
  onDeleteAccount?: (name: string) => void;
  onOpenCreator?: (accountName: string) => void;
}

interface ShopProps {
  type: "shop";
  accounts: ShopAccount[];
  loading: boolean;
  onRefresh: () => void;
}

type Props = CreatorProps | ShopProps;

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

function AddAccountModal({
  open,
  onOk,
  onCancel,
}: {
  open: boolean;
  onOk: (name: string) => void;
  onCancel: () => void;
}) {
  const { message } = App.useApp();
  const [name, setName] = useState("");

  function handleOk() {
    const trimmed = name.trim();
    if (!trimmed) {
      message.warning("请输入账号名称");
      return;
    }
    onOk(trimmed);
    setName("");
  }

  return (
    <Modal
      title="添加账号"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="添加"
      cancelText="取消"
      destroyOnHidden
    >
      <Input
        placeholder="输入账号名称"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onPressEnter={handleOk}
      />
    </Modal>
  );
}

function renderCookieTag(acc: { cookieStatus?: string; cookieDetail?: string | null }) {
  const status = acc.cookieStatus;

  if (!status || status === "missing") {
    return (
      <Tag icon={<CloseCircleOutlined />} color="default">
        未登录
      </Tag>
    );
  }

  if (status === "valid") {
    return (
      <Tooltip title={acc.cookieDetail || "登录态有效"}>
        <Tag icon={<CheckCircleOutlined />} color="success">
          有效
        </Tag>
      </Tooltip>
    );
  }

  if (status === "warning") {
    return (
      <Tooltip title={acc.cookieDetail || "登录态可能过期"}>
        <Tag icon={<ExclamationCircleOutlined />} color="warning">
          可能过期
        </Tag>
      </Tooltip>
    );
  }

  if (status === "expired") {
    return (
      <Tooltip title={acc.cookieDetail || "登录态已过期"}>
        <Tag icon={<CloseCircleOutlined />} color="error">
          已过期
        </Tag>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={acc.cookieDetail || "未知状态"}>
      <Tag icon={<QuestionCircleOutlined />} color="default">
        未知
      </Tag>
    </Tooltip>
  );
}

export default function AccountTable(props: Props) {
  const { accounts, loading, onRefresh, type } = props;
  const { message } = App.useApp();

  if (type === "creator") {
    const { onLogin, onAddAccount, onDeleteAccount, onOpenCreator } = props as CreatorProps;
    const { isNamespaceBusy } = useTaskContext();
    const loginBusy = isNamespaceBusy("login");
    const [modalOpen, setModalOpen] = useState(false);
    const [verifying, setVerifying] = useState<Set<string>>(new Set());
    const [verifyAllLoading, setVerifyAllLoading] = useState(false);

    // Store verify results locally so we can show them immediately
    const [verifyResults, setVerifyResults] = useState<Record<string, { status: string; detail: string }>>({});

    // Reset verify results when accounts prop changes (e.g. after refresh)
    useEffect(() => {
      setVerifyResults({});
    }, [accounts]);

    const mergedAccounts = useMemo(() => {
      return (accounts as CreatorAccount[]).map((a) => {
        const vr = verifyResults[a.name];
        if (!vr) return a;
        return {
          ...a,
          cookieStatus: vr.status as CreatorAccount["cookieStatus"],
          cookieDetail: vr.detail,
        };
      });
    }, [accounts, verifyResults]);

    function mapCreatorVerifyStatus(result: { verified: boolean; status?: string }) {
      if (result.verified) return "valid";
      if (result.status === "missing") return "missing";
      return "expired";
    }

    async function runCreatorVerify(accountName: string) {
      const res = await fetch("/api/creator/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountName }),
      });
      if (!res.ok) throw new Error("验证请求失败");
      return res.json() as Promise<{
        verified: boolean;
        status?: string;
        detail: string;
        elapsed?: number;
      }>;
    }

    async function handleVerify(accountName: string) {
      setVerifying((prev) => new Set(prev).add(accountName));
      try {
        const result = await runCreatorVerify(accountName);
        const status = mapCreatorVerifyStatus(result);

        if (result.verified) {
          message.success(
            `账号 ${accountName} 验证通过 (${((result.elapsed ?? 0) / 1000).toFixed(1)}s)`
          );
        } else {
          message.warning(`账号 ${accountName} 验证失败: ${result.detail}`);
        }

        setVerifyResults((prev) => ({
          ...prev,
          [accountName]: {
            status,
            detail: result.detail,
          },
        }));
      } catch (e: any) {
        message.error(`验证失败: ${e.message || e}`);
      }
      setVerifying((prev) => {
        const next = new Set(prev);
        next.delete(accountName);
        return next;
      });
    }

    async function handleVerifyAll() {
      const list = (accounts as CreatorAccount[]).map((a) => String(a.name || "").trim()).filter(Boolean);
      if (list.length === 0) {
        message.warning("暂无账号");
        return;
      }

      setVerifyAllLoading(true);
      let ok = 0;
      let fail = 0;

      try {
        for (const accountName of list) {
          setVerifying((prev) => new Set(prev).add(accountName));
          try {
            const result = await runCreatorVerify(accountName);
            const status = mapCreatorVerifyStatus(result);
            setVerifyResults((prev) => ({
              ...prev,
              [accountName]: { status, detail: result.detail },
            }));
            if (result.verified) ok += 1;
            else fail += 1;
          } catch (e: any) {
            fail += 1;
            message.error(`${accountName}: ${e.message || e}`);
          }
          setVerifying((prev) => {
            const next = new Set(prev);
            next.delete(accountName);
            return next;
          });
        }
      } finally {
        setVerifyAllLoading(false);
      }

      await Promise.resolve(onRefresh());
      message.success(`全部校验完成：${ok} 个登录态有效，${fail} 个无效或异常`);
    }

    const columns = [
      { title: "账号名称", dataIndex: "name", key: "name" },
      {
        title: "登录态",
        dataIndex: "cookieStatus",
        key: "cookieStatus",
        width: 100,
        render: (_: any, row: CreatorAccount) => renderCookieTag(row),
      },
      {
        title: "最后登录",
        dataIndex: "lastLoginAt",
        key: "lastLoginAt",
        width: 130,
        render: (_: any, row: CreatorAccount) => formatShortDateTime(row.lastLoginAt),
      },
      {
        title: "操作",
        key: "actions",
        width: 280,
        render: (_: any, row: CreatorAccount) => {
          const hasReusableLoginState =
            row.hasStorageState &&
            row.cookieStatus !== "expired" &&
            row.cookieStatus !== "missing";
          const canUseLoggedInActions =
            row.hasStorageState && row.cookieStatus !== "expired";
          const isVerifying = verifying.has(row.name);

          const items = [
            {
              key: "email_qr",
              label: "邮箱二维码登录",
              onClick: () => onLogin?.(row.name, "email_qr"),
            },
            {
              key: "local_manual",
              label: "本机人工登录",
              onClick: () => onLogin?.(row.name, "local_manual"),
            },
          ];

          return (
            <Space size={4}>
              <Dropdown
                trigger={["hover"]}
                placement="bottomRight"
                menu={{ items: items as any }}
                disabled={hasReusableLoginState || loginBusy}
              >
                <Button
                  size="small"
                  type="primary"
                  disabled={hasReusableLoginState || loginBusy}
                  onClick={() => onLogin?.(row.name, "email_qr")}
                >
                  <Space size={4}>
                    登录
                    <DownOutlined style={{ fontSize: 10 }} />
                  </Space>
                </Button>
              </Dropdown>
              <Button
                size="small"
                icon={<SafetyCertificateOutlined />}
                loading={isVerifying}
                disabled={!canUseLoggedInActions}
                onClick={() => handleVerify(row.name)}
              >
                验证
              </Button>
              {onOpenCreator && (
                <Button
                  size="small"
                  type="primary"
                  disabled={!canUseLoggedInActions}
                  onClick={() => onOpenCreator(row.name)}
                >
                  抖创页面
                </Button>
              )}
              {onDeleteAccount && (
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={() => onDeleteAccount(row.name)}
                >
                  删除
                </Button>
              )}
            </Space>
          );
        },
      },
    ];

    const dataSource = mergedAccounts.map((a, i) => ({
      ...a,
      key: a.name || String(i),
    }));

    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>店铺账号设置</h3>
          <Space>
            {onAddAccount && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setModalOpen(true)}
              >
                添加账号
              </Button>
            )}
            <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
              刷新
            </Button>
            <Button
              icon={<SafetyCertificateOutlined />}
              loading={verifyAllLoading}
              disabled={accounts.length === 0 || loading}
              onClick={() => void handleVerifyAll()}
            >
              校验所有账号
            </Button>
          </Space>
        </div>
        <Table
          columns={columns as any}
          dataSource={dataSource}
          pagination={false}
          loading={loading}
          size="small"
          locale={{ emptyText: "暂无账号，请点击右上角添加" }}
        />

        {onAddAccount && (
          <AddAccountModal
            open={modalOpen}
            onOk={(name) => {
              onAddAccount(name);
              setModalOpen(false);
            }}
            onCancel={() => setModalOpen(false)}
          />
        )}
      </div>
    );
  }

  // Shop mode - simpler version (used when AccountTable is called with type="shop")
  const shopAccounts = (accounts as ShopAccount[]);

  const columns = [
    { title: "邮箱", dataIndex: "email", key: "email" },
    {
      title: "登录态",
      dataIndex: "cookieStatus",
      key: "cookieStatus",
      width: 100,
      render: (_: any, row: ShopAccount) => renderCookieTag(row),
    },
    {
      title: "最后登录",
      dataIndex: "lastLoginAt",
      key: "lastLoginAt",
      width: 130,
      render: (_: any, row: ShopAccount) => formatShortDateTime(row.lastLoginAt),
    },
  ];

  const dataSource = shopAccounts.map((a, i) => ({
    ...a,
    key: a.email || String(i),
  }));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>邮箱账号状态</h3>
        <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
          刷新
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        loading={loading}
        size="small"
        locale={{ emptyText: "暂无邮箱账号" }}
      />
    </div>
  );
}
