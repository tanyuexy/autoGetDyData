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
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  DownOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type { CreatorAccount, ShopAccount } from "@/types";
import { useState } from "react";

interface CreatorProps {
  type: "creator";
  accounts: CreatorAccount[];
  loading: boolean;
  onRefresh: () => void;
  onLogin?: (accountName: string, mode: "email_qr" | "local_manual") => void;
  onAddAccount?: (name: string) => void;
  onDeleteAccount?: (name: string) => void;
}

interface ShopProps {
  type: "shop";
  accounts: ShopAccount[];
  loading: boolean;
  onRefresh: () => void;
}

type Props = CreatorProps | ShopProps;

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
      destroyOnClose
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

export default function AccountTable(props: Props) {
  const { accounts, loading, onRefresh, type } = props;

  if (type === "creator") {
    const { onLogin, onAddAccount, onDeleteAccount } = props as CreatorProps;
    const [modalOpen, setModalOpen] = useState(false);

    const columns = [
      { title: "账号名称", dataIndex: "name", key: "name" },
      {
        title: "登录态",
        dataIndex: "hasStorageState",
        key: "hasStorageState",
        render: (v: boolean) =>
          v ? (
            <Tag icon={<CheckCircleOutlined />} color="success">
              有效
            </Tag>
          ) : (
            <Tag icon={<CloseCircleOutlined />} color="default">
              未登录
            </Tag>
          ),
      },
      {
        title: "操作",
        key: "actions",
        width: 160,
        render: (_: any, row: CreatorAccount) => {
          const disabled = row.hasStorageState;

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
                disabled={disabled}
              >
                <Button
                  size="small"
                  type="primary"
                  disabled={disabled}
                  onClick={() => onLogin?.(row.name, "email_qr")}
                >
                  <Space size={4}>
                    登录
                    <DownOutlined style={{ fontSize: 10 }} />
                  </Space>
                </Button>
              </Dropdown>
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

    const dataSource = (accounts as CreatorAccount[]).map((a, i) => ({
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

  // Shop mode
  const columns = [
    { title: "邮箱", dataIndex: "email", key: "email" },
    {
      title: "登录态",
      dataIndex: "hasStorageState",
      key: "hasStorageState",
      render: (v: boolean) =>
        v ? (
          <Tag icon={<CheckCircleOutlined />} color="success">
            有效
          </Tag>
        ) : (
          <Tag icon={<CloseCircleOutlined />} color="default">
            未登录
          </Tag>
        ),
    },
  ];

  const dataSource = (accounts as ShopAccount[]).map((a, i) => ({
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
