"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Space, Divider, App, Button, Select, Typography } from "antd";
import AccountTable from "@/components/AccountTable";
import { useTaskContext } from "@/contexts/TaskContext";
import type { ShopAccount } from "@/types";

const { Text } = Typography;
const SHOP_SELECTION_CACHE_KEY = "shop:selectedShopNames";

function readCachedShopSelection() {
  try {
    const cached = JSON.parse(
      window.localStorage.getItem(SHOP_SELECTION_CACHE_KEY) || "[]"
    );
    return Array.isArray(cached) ? cached.map((name) => String(name)) : [];
  } catch {
    return [];
  }
}

export default function ShopPage() {
  const { message } = App.useApp();
  const [accounts, setAccounts] = useState<ShopAccount[]>([]);
  const [shopNames, setShopNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShopNames, setSelectedShopNamesState] = useState<string[]>([]);
  const hasHydratedSelectionRef = useRef(false);
  const isApplyingInitialSelectionRef = useRef(false);

  const setSelectedShopNames = useCallback((value: string[]) => {
    setSelectedShopNamesState(value);
    if (isApplyingInitialSelectionRef.current) return;
    try {
      window.localStorage.setItem(
        SHOP_SELECTION_CACHE_KEY,
        JSON.stringify(value)
      );
    } catch {}
  }, []);

  const { startTask, done, isNamespaceBusy } = useTaskContext();

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/shop/list");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
        setShopNames(data.shopNames || []);
      }
    } catch {
      message.error("获取账号列表失败");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (done) {
      fetchAccounts();
    }
  }, [done]);

  useEffect(() => {
    if (!shopNames.length) return;

    isApplyingInitialSelectionRef.current = true;
    setSelectedShopNamesState((prev) => {
      const cached = readCachedShopSelection().filter((name) =>
        shopNames.includes(name)
      );

      if (!hasHydratedSelectionRef.current) {
        hasHydratedSelectionRef.current = true;
        if (cached.length > 0) return cached;
      }

      if (cached.length > 0) return cached;

      if (prev.length > 0) {
        return prev.filter((name) => shopNames.includes(name));
      }
      return shopNames;
    });
    isApplyingInitialSelectionRef.current = false;
  }, [shopNames]);

  async function handleAction(action: "export" | "feishu-sync" | "sync-feishu") {
    if (!selectedShopNames.length) {
      message.warning("请先选择店铺");
      return;
    }

    try {
      window.localStorage.setItem(
        SHOP_SELECTION_CACHE_KEY,
        JSON.stringify(selectedShopNames)
      );
    } catch {}

    const endpoints: Record<string, string> = {
      export: "/api/shop/export",
      "feishu-sync": "/api/shop/feishu-sync",
      "sync-feishu": "/api/shop/sync-feishu",
    };
    try {
      await startTask(endpoints[action], { shopNames: selectedShopNames }, "shop-export");
      message.info("任务已启动");
    } catch (e: any) {
      message.error(e.message || "启动任务失败");
    }
  }

  const loggedInCount = accounts.filter((a) => a.hasStorageState).length;

  return (
    <Space orientation="vertical" size="small" style={{ width: "100%" }}>
      <AccountTable
        type="shop"
        accounts={accounts}
        loading={loading}
        onRefresh={fetchAccounts}
      />

      <Divider />

      <div>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>执行任务</h3>
        <div style={{ color: "#888", marginBottom: 8, fontSize: 12 }}>
          已登录 {loggedInCount}/{accounts.length} 个邮箱
        </div>

        <Space wrap style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            选择店铺：
          </Text>
          <Select
            mode="multiple"
            allowClear
            placeholder="请选择店铺（默认选中全部配置店铺）"
            style={{ minWidth: 360 }}
            value={selectedShopNames}
            onChange={(v) => setSelectedShopNames(v)}
            options={shopNames.map((name) => ({
              label: name,
              value: name,
            }))}
          />
        </Space>

        <div>
        <Space wrap>
          <Button
            type="primary"
            onClick={() => handleAction("export")}
            disabled={shopNames.length === 0 || isNamespaceBusy("shop-export")}
          >
            导出数据
          </Button>
          <Button
            type="primary"
            onClick={() => handleAction("feishu-sync")}
            disabled={shopNames.length === 0 || isNamespaceBusy("shop-export")}
          >
            同步多维表格
          </Button>
          <Button
            danger
            type="primary"
            onClick={() => handleAction("sync-feishu")}
            disabled={shopNames.length === 0 || isNamespaceBusy("shop-export")}
          >
            导出并推送
          </Button>
        </Space>
        </div>
      </div>
    </Space>
  );
}
