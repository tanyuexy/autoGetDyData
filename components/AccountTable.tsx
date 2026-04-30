"use client";

import { Table, Tag, Button, Dropdown, Space } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined, DownOutlined } from "@ant-design/icons";
import type { CreatorAccount, ShopAccount } from "@/types";

interface CreatorProps {
  type: "creator";
  accounts: CreatorAccount[];
  loading: boolean;
  onRefresh: () => void;
  onLogin?: (accountName: string, mode: "email_qr" | "local_manual") => void;
}

interface ShopProps {
  type: "shop";
  accounts: ShopAccount[];
  loading: boolean;
  onRefresh: () => void;
}

type Props = CreatorProps | ShopProps;

export default function AccountTable(props: Props) {
  const { accounts, loading, onRefresh, type } = props;

  if (type === "creator") {
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
      ...(props.onLogin
        ? [
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
                    onClick: () => props.onLogin?.(row.name, "email_qr"),
                  },
                  {
                    key: "local_manual",
                    label: "本机人工登录",
                    onClick: () => props.onLogin?.(row.name, "local_manual"),
                  },
                ];

                return (
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
                      onClick={() => props.onLogin?.(row.name, "email_qr")}
                    >
                      <Space size={4}>
                        登录
                        <DownOutlined style={{ fontSize: 10 }} />
                      </Space>
                    </Button>
                  </Dropdown>
                );
              },
            },
          ]
        : []),
    ];

    const dataSource = (accounts as CreatorAccount[]).map((a, i) => ({
      ...a,
      key: a.name || String(i),
    }));

    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>账号状态</h3>
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
            刷新
          </Button>
        </div>
        <Table
          columns={columns as any}
          dataSource={dataSource}
          pagination={false}
          loading={loading}
          size="small"
          locale={{ emptyText: "暂无账号" }}
        />
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
