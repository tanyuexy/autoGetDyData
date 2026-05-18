"use client";

import { useEffect, useMemo, useState } from "react";
import { App, Button, Divider, Space, Typography, Table, Tag } from "antd";
import FeishuAuthPanel from "@/components/FeishuAuthPanel";
import { useTaskContext } from "@/contexts/TaskContext";
import { semanticTagStyle } from "@/lib/semanticTagStyles";

const { Text } = Typography;

type BackupFileKey = "creator" | "shop";

type BackupFileInfo = {
  key: BackupFileKey;
  filename: string;
  exists: boolean;
  size: number;
  mtime: string | null;
};

export default function FeishuPage() {
  const { message } = App.useApp();

  const { startTask, done } = useTaskContext();

  const [files, setFiles] = useState<BackupFileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);

  async function refreshFiles() {
    setFilesLoading(true);
    try {
      const res = await fetch("/api/feishu/backup-files", { cache: "no-store" });
      if (!res.ok) throw new Error("获取备份文件列表失败");
      const data = await res.json();
      setFiles(Array.isArray(data?.files) ? data.files : []);
    } catch (e: any) {
      message.error(e.message || "获取失败");
    } finally {
      setFilesLoading(false);
    }
  }

  useEffect(() => {
    refreshFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (done) {
      setBackupLoading(false);
      refreshFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  async function handleBackupBoth() {
    setBackupLoading(true);
    try {
      await startTask("/api/feishu/backup", { profiles: "creator,shop" }, "feishu");
      message.info("备份任务已启动");
    } catch (e: any) {
      setBackupLoading(false);
      message.error(e.message || "启动失败");
    }
  }

  const columns = useMemo(
    () => [
      {
        title: "表",
        dataIndex: "key",
        key: "key",
        width: 90,
        render: (v: BackupFileKey) => (v === "creator" ? "抖创" : "抖店"),
      },
      {
        title: "文件",
        dataIndex: "filename",
        key: "filename",
        render: (v: string) => <Text code>{v}</Text>,
      },
      {
        title: "状态",
        dataIndex: "exists",
        key: "exists",
        width: 90,
        render: (exists: boolean) =>
          exists ? (
            <Tag style={semanticTagStyle("success")}>已生成</Tag>
          ) : (
            <Tag style={semanticTagStyle("default")}>不存在</Tag>
          ),
      },
      {
        title: "更新时间",
        dataIndex: "mtime",
        key: "mtime",
        width: 190,
        render: (v: string | null) => (v ? new Date(v).toLocaleString("zh-CN") : "-"),
      },
      {
        title: "大小",
        dataIndex: "size",
        key: "size",
        width: 110,
        render: (v: number) => (v ? `${Math.round(v / 1024)} KB` : "-"),
      },
      {
        title: "操作",
        key: "actions",
        width: 120,
        render: (_: any, row: BackupFileInfo) => (
          <Button
            size="small"
            disabled={!row.exists}
            onClick={() => {
              window.open(`/api/feishu/backup-download/${row.key}`, "_blank");
            }}
          >
            下载
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
      <div>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>OAuth 认证</h3>
        <FeishuAuthPanel />
      </div>

      <Divider />

      <div>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>数据操作</h3>

        <Space style={{ marginBottom: 8 }} wrap>
          <Button type="primary" onClick={handleBackupBoth} loading={backupLoading}>
            备份多维表格文件（抖创 + 抖店）
          </Button>
          <Button onClick={refreshFiles} loading={filesLoading}>
            刷新备份列表
          </Button>
        </Space>

        <Table
          size="small"
          rowKey={(r) => r.key}
          loading={filesLoading}
          columns={columns as any}
          dataSource={files}
          pagination={false}
        />

        <Divider />
      </div>
    </Space>
  );
}
