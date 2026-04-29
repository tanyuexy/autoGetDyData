"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, Space, Tag, Typography, Alert, App } from "antd";
import {
  LinkOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";

const { Text } = Typography;

export default function FeishuAuthPanel() {
  const { message } = App.useApp();
  const [tokenStatus, setTokenStatus] = useState<{
    hasToken: boolean;
    valid: boolean;
    expiresAt: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);

  const checkStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch("/api/feishu/token-status");
      if (res.ok) {
        setTokenStatus(await res.json());
      }
    } catch {
      // ignore
    }
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  async function handleAuth() {
    setLoading(true);
    try {
      const res = await fetch("/api/feishu/auth-url", { method: "POST" });
      if (res.ok) {
        const { url } = await res.json();
        window.open(url, "_blank", "width=800,height=700");
        message.info("请在打开的飞书页面中完成授权");
      } else {
        message.error("获取授权 URL 失败");
      }
    } catch {
      message.error("请求失败");
    }
    setLoading(false);
  }

  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
      <div
        style={{
          padding: 12,
          border: "1px solid #f0f0f0",
          borderRadius: 8,
          background: "#fafafa",
        }}
      >
        <Space orientation="vertical" size="small">
          <Space>
            <Text strong>Token 状态：</Text>
            {statusLoading ? (
              <Tag>查询中...</Tag>
            ) : tokenStatus?.hasToken ? (
              tokenStatus.valid ? (
                <Tag icon={<CheckCircleOutlined />} color="success">
                  有效
                </Tag>
              ) : (
                <Tag icon={<ExclamationCircleOutlined />} color="warning">
                  已过期
                </Tag>
              )
            ) : (
              <Tag icon={<ExclamationCircleOutlined />} color="default">
                未授权
              </Tag>
            )}
          </Space>
          {tokenStatus?.expiresAt && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              过期时间：{new Date(tokenStatus.expiresAt).toLocaleString("zh-CN")}
            </Text>
          )}
        </Space>
      </div>

      <Space>
        <Button
          type="primary"
          icon={<LinkOutlined />}
          onClick={handleAuth}
          loading={loading}
        >
          飞书授权
        </Button>
        <Button icon={<ReloadOutlined />} onClick={checkStatus} loading={statusLoading}>
          刷新状态
        </Button>
      </Space>

      {!tokenStatus?.hasToken && !statusLoading && (
        <Alert
          type="info"
          title="尚未完成飞书 OAuth 授权，请点击「飞书授权」按钮进行授权"
        />
      )}
    </Space>
  );
}
