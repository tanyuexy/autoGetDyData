"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Form, Input, Spin, Typography } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = searchParams.get("from") || "/creator";

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "登录失败");
      }
      router.replace(from.startsWith("/") ? from : "/creator");
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card style={{ width: "100%", maxWidth: 400 }} title="后台登录">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        账号由环境变量配置，请联系管理员获取凭据。
      </Typography.Paragraph>
      {error ? <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} /> : null}
      <Form layout="vertical" onFinish={onFinish} autoComplete="off">
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
          <Input prefix={<UserOutlined />} placeholder="用户名" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="密码" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          登录
        </Button>
      </Form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--ic-canvas, #f5f5f5)",
      }}
    >
      <Suspense fallback={<Spin />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
