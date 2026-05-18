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
  Typography,
  Flex,
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
import type { CSSProperties } from "react";
import { useState, useMemo, useEffect } from "react";
import { useTaskContext } from "@/contexts/TaskContext";
import { semanticTagStyle } from "@/lib/semanticTagStyles";

interface CreatorProps {
  type: "creator";
  accounts: CreatorAccount[];
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  /** 表头与单元格内容居中（抖创数据页、配置管理等） */
  centerHeader?: boolean;
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
  centerHeader?: boolean;
}

type Props = CreatorProps | ShopProps;

/** 抖创数据 / 配置里账号区块的版面与外层表格容器 */
function accountTableShellSx(): CSSProperties {
  return {
    border: "1px solid var(--vol-hairline)",
    borderRadius: 12,
    overflow: "hidden",
    background: "var(--vol-canvas-soft)",
    boxShadow: "none",
  };
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
      <Tag
        icon={<CloseCircleOutlined />}
        style={{ ...semanticTagStyle("default"), borderRadius: 6 }}
      >
        未登录
      </Tag>
    );
  }

  if (status === "valid") {
    return (
      <Tooltip title={acc.cookieDetail || "登录态有效"}>
        <Tag
          icon={<CheckCircleOutlined />}
          style={{ ...semanticTagStyle("success"), borderRadius: 6 }}
        >
          有效
        </Tag>
      </Tooltip>
    );
  }

  if (status === "warning") {
    return (
      <Tooltip title={acc.cookieDetail || "登录态可能过期"}>
        <Tag
          icon={<ExclamationCircleOutlined />}
          style={{ ...semanticTagStyle("warning"), borderRadius: 6 }}
        >
          可能过期
        </Tag>
      </Tooltip>
    );
  }

  if (status === "expired") {
    return (
      <Tooltip title={acc.cookieDetail || "登录态已过期"}>
        <Tag icon={<CloseCircleOutlined />} style={{ ...semanticTagStyle("error"), borderRadius: 6 }}>
          已过期
        </Tag>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={acc.cookieDetail || "未知状态"}>
      <Tag
        icon={<QuestionCircleOutlined />}
        style={{ ...semanticTagStyle("default"), borderRadius: 6 }}
      >
        未知
      </Tag>
    </Tooltip>
  );
}

export default function AccountTable(props: Props) {
  const { accounts, loading, onRefresh, type, centerHeader = false } = props;
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
            `账号 ${accountName} 校验通过 (${((result.elapsed ?? 0) / 1000).toFixed(1)}s)`
          );
        } else {
          message.warning(`账号 ${accountName} 校验未通过: ${result.detail}`);
        }

        setVerifyResults((prev) => ({
          ...prev,
          [accountName]: {
            status,
            detail: result.detail,
          },
        }));
      } catch (e: any) {
        message.error(`校验异常: ${e.message || e}`);
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
      {
        title: "账号名称",
        key: "name",
        ellipsis: true,
        ...(centerHeader ? { align: "center" as const } : {}),
        render: (_: unknown, row: CreatorAccount) => (
          <Tooltip title={row.name} placement={centerHeader ? "top" : "topLeft"}>
            <span
              style={{
                fontWeight: 500,
                color: "var(--vol-ink)",
              }}
            >
              {row.name}
            </span>
          </Tooltip>
        ),
      },
      {
        title: "登录态",
        dataIndex: "cookieStatus",
        key: "cookieStatus",
        width: 112,
        ...(centerHeader ? { align: "center" as const } : {}),
        render: (_: unknown, row: CreatorAccount) => renderCookieTag(row),
      },
      {
        title: "最后登录",
        dataIndex: "lastLoginAt",
        key: "lastLoginAt",
        width: 132,
        ...(centerHeader ? { align: "center" as const } : {}),
        render: (_: unknown, row: CreatorAccount) => (
          <span
            style={{
              fontSize: 13,
              fontVariantNumeric: "tabular-nums",
              color: "var(--vol-mute)",
            }}
          >
            {formatShortDateTime(row.lastLoginAt)}
          </span>
        ),
      },
      {
        title: "操作",
        key: "actions",
        align: centerHeader ? "center" : "right",
        width: onLogin ? 340 : 200,
        render: (_: unknown, row: CreatorAccount) => {
          const hasReusableLoginState =
            row.hasStorageState &&
            row.cookieStatus !== "expired" &&
            row.cookieStatus !== "missing";
          const canUseLoggedInActions =
            row.hasStorageState && row.cookieStatus !== "expired";
          const isVerifying = verifying.has(row.name);

          const loginMenuItems =
            onLogin &&
            ([
              {
                key: "email_qr",
                label: "远程扫码登录（企微/邮件提醒）",
                onClick: () => onLogin(row.name, "email_qr"),
              },
              {
                key: "local_manual",
                label: "本机人工登录",
                onClick: () => onLogin(row.name, "local_manual"),
              },
            ] as const);

          return (
            <Flex
              wrap="nowrap"
              gap={4}
              justify={centerHeader ? "center" : "flex-end"}
              align="center"
              style={{ minWidth: 0 }}
            >
              {onLogin && loginMenuItems && (
                <Dropdown
                  trigger={["hover"]}
                  placement="bottomRight"
                  menu={{ items: loginMenuItems as any }}
                  disabled={hasReusableLoginState || loginBusy}
                >
                  <Button
                    size="small"
                    type="primary"
                    style={{ borderRadius: 6 }}
                    disabled={hasReusableLoginState || loginBusy}
                    onClick={() => onLogin(row.name, "email_qr")}
                  >
                    <Flex align="center" gap={6}>
                      登录
                      <DownOutlined style={{ fontSize: 10 }} />
                    </Flex>
                  </Button>
                </Dropdown>
              )}
              <Tooltip
                title={
                  !canUseLoggedInActions
                    ? "需要本地可用的登录存档，且当前未被静态判定为「已过期」，方可校验。"
                    : "在浏览器中校验登录态是否仍有效。"
                }
              >
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    color="cyan"
                    style={{ borderRadius: 6 }}
                    icon={<SafetyCertificateOutlined />}
                    loading={isVerifying}
                    disabled={!canUseLoggedInActions}
                    onClick={() => handleVerify(row.name)}
                  >
                    校验
                  </Button>
                </span>
              </Tooltip>
              {onOpenCreator && (
                <Tooltip title={canUseLoggedInActions ? "使用该账号会话打开抖音创作者后台" : "登录态不可用，无法浏览器打开后台。"}>
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      color="primary"
                      style={{ borderRadius: 6 }}
                      disabled={!canUseLoggedInActions}
                      onClick={() => onOpenCreator(row.name)}
                    >
                      抖创页面
                    </Button>
                  </span>
                </Tooltip>
              )}
              {onDeleteAccount && (
                <Button
                  size="small"
                  type="link"
                  danger
                  style={{ paddingInline: 2, flexShrink: 0 }}
                  onClick={() => onDeleteAccount(row.name)}
                >
                  删除
                </Button>
              )}
            </Flex>
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
        <Flex justify="space-between" align="flex-start" gap={14} wrap="wrap" style={{ marginBottom: 14 }}>
          <div style={{ minWidth: 200 }}>
            <Typography.Title level={5} style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>
              店铺账号设置
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {onAddAccount
                ? "在此添加或删除配置的账号；可登录浏览器、校验登录态、打开创作者中心。"
                : "查看各账号静态登录快照；在浏览器内校验请点击「校验」或「校验所有账号」；如需登录请到「配置管理」。"}
            </Typography.Text>
          </div>
          <Space wrap size={[8, 10]}>
            {onAddAccount && (
              <Button type="primary" icon={<PlusOutlined />} style={{ borderRadius: 8 }} onClick={() => setModalOpen(true)}>
                添加账号
              </Button>
            )}
            <Button icon={<ReloadOutlined />} variant="outlined" loading={loading} style={{ borderRadius: 8 }} onClick={() => void onRefresh()}>
              刷新
            </Button>
            <Button
              icon={<SafetyCertificateOutlined />}
              type="primary"
              variant="outlined"
              loading={verifyAllLoading}
              disabled={accounts.length === 0 || loading}
              style={{ borderRadius: 8 }}
              onClick={() => void handleVerifyAll()}
            >
              校验所有账号
            </Button>
          </Space>
        </Flex>

        <div style={accountTableShellSx()}>
          <Table<CreatorAccount>
            columns={columns as any}
            dataSource={dataSource}
            pagination={false}
            loading={loading}
            size="middle"
            bordered={false}
            rowHoverable={false}
            locale={{
              emptyText: (
                <Typography.Text type="secondary" style={{ display: "block", paddingBlock: 24 }}>
                  {onAddAccount ? "暂无账号，点击「添加账号」开始配置。" : "暂无账号数据。"}
                </Typography.Text>
              ),
            }}
            styles={{
              header: {
                cell: {
                  background: "var(--ic-surface-2)",
                  color: "var(--ic-ink-muted)",
                  fontWeight: 500,
                  fontSize: 12,
                  letterSpacing: "0.02em",
                  ...(centerHeader ? { textAlign: "center" as const } : {}),
                },
              },
              body: {
                cell: {
                  padding: "12px 14px",
                  ...(centerHeader ? { textAlign: "center" as const } : {}),
                },
              },
            }}
          />
        </div>

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

  const shopColumns = [
    {
      title: "邮箱",
      key: "email",
      ellipsis: true,
      ...(centerHeader ? { align: "center" as const } : {}),
      render: (_: unknown, row: ShopAccount) => (
        <Tooltip title={row.email} placement={centerHeader ? "top" : "topLeft"}>
          <span style={{ fontWeight: 500, color: "var(--vol-ink)" }}>{row.email}</span>
        </Tooltip>
      ),
    },
    {
      title: "登录态",
      dataIndex: "cookieStatus",
      key: "cookieStatus",
      width: 112,
      ...(centerHeader ? { align: "center" as const } : {}),
      render: (_: unknown, row: ShopAccount) => renderCookieTag(row),
    },
    {
      title: "最后登录",
      dataIndex: "lastLoginAt",
      key: "lastLoginAt",
      width: 132,
      ...(centerHeader ? { align: "center" as const } : {}),
      render: (_: unknown, row: ShopAccount) => (
        <span
          style={{
            fontSize: 13,
            fontVariantNumeric: "tabular-nums",
            color: "var(--vol-mute)",
          }}
        >
          {formatShortDateTime(row.lastLoginAt)}
        </span>
      ),
    },
  ];

  const shopDataSource = shopAccounts.map((a, i) => ({
    ...a,
    key: a.email || String(i),
  }));

  return (
    <div>
      <Flex justify="space-between" align="flex-start" gap={14} wrap="wrap" style={{ marginBottom: 14 }}>
        <div style={{ minWidth: 200 }}>
          <Typography.Title level={5} style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>
            邮箱账号状态
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            各邮箱最近一次持久化会话与静态快照（完整校验请到配置或抖店任务流）。
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} variant="outlined" loading={loading} style={{ borderRadius: 8 }} onClick={() => void onRefresh()}>
          刷新
        </Button>
      </Flex>

      <div style={accountTableShellSx()}>
        <Table<ShopAccount>
          columns={shopColumns}
          dataSource={shopDataSource}
          pagination={false}
          loading={loading}
          size="middle"
          bordered={false}
          rowHoverable={false}
          locale={{
            emptyText: (
              <Typography.Text type="secondary" style={{ display: "block", paddingBlock: 24 }}>
                暂无邮箱账号。
              </Typography.Text>
            ),
          }}
          styles={{
            header: {
              cell: {
                background: "var(--ic-surface-2)",
                color: "var(--ic-ink-muted)",
                fontWeight: 500,
                fontSize: 12,
                letterSpacing: "0.02em",
                ...(centerHeader ? { textAlign: "center" as const } : {}),
              },
            },
            body: {
              cell: {
                padding: "12px 14px",
                ...(centerHeader ? { textAlign: "center" as const } : {}),
              },
            },
          }}
        />
      </div>
    </div>
  );
}
