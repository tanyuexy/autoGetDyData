"use client";

import { Table, Tag, Button } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import type { CreatorAccount, ShopAccount } from "@/types";

interface CreatorProps {
  type: "creator";
  accounts: CreatorAccount[];
  loading: boolean;
  onRefresh: () => void;
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
      {
        title: "Cookies",
        dataIndex: "hasCookies",
        key: "hasCookies",
        render: (v: boolean) =>
          v ? <Tag color="blue">有</Tag> : <Tag color="default">无</Tag>,
      },
      {
        title: "导出日期",
        dataIndex: "exportDateStart",
        key: "exportDateStart",
        render: (v: string | null) => v || "-",
      },
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
          columns={columns}
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
