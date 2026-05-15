"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Space, Divider, App, Button, Select, Typography, DatePicker } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import AccountTable from "@/components/AccountTable";
import { useTaskContext } from "@/contexts/TaskContext";
import type { ShopAccount } from "@/types";

const { Text } = Typography;
const { RangePicker } = DatePicker;

/** Select 第一项「一键全选」的哨兵值，不会作为店铺名传给接口 */
const MULTI_SELECT_ALL_SHOPS = "__toolbar_all_shop_export_shops__";

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
  const [exportDateRange, setExportDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [loadingDateRange, setLoadingDateRange] = useState(false);
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

  const fetchDefaultExportRange = useCallback(async () => {
    setLoadingDateRange(true);
    try {
      const res = await fetch("/api/shop/export", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载默认导出日期失败");
      if (data.startDate && data.endDate) {
        setExportDateRange([dayjs(data.startDate, "YYYY-MM-DD"), dayjs(data.endDate, "YYYY-MM-DD")]);
      }
    } catch (e: any) {
      message.error(e.message || "加载默认导出日期失败");
    }
    setLoadingDateRange(false);
  }, [message]);

  useEffect(() => {
    fetchDefaultExportRange();
  }, [fetchDefaultExportRange]);

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

  const shopSelectOptions = useMemo(
    () => [
      {
        label: shopNames.length ? `全选（${shopNames.length} 个店铺）` : "全选（无店铺）",
        value: MULTI_SELECT_ALL_SHOPS,
        disabled: shopNames.length === 0,
      },
      ...shopNames.map((name) => ({ label: name, value: name })),
    ],
    [shopNames]
  );

  const shopsSanitized = useMemo(
    () => selectedShopNames.filter((name) => shopNames.includes(name)),
    [selectedShopNames, shopNames]
  );

  const handleShopSelectChange = useCallback(
    (vals: string[]) => {
      const picked = [...new Set(vals)];
      if (picked.includes(MULTI_SELECT_ALL_SHOPS)) {
        setSelectedShopNames([...shopNames]);
        return;
      }
      setSelectedShopNames(picked.filter((v) => v !== MULTI_SELECT_ALL_SHOPS));
    },
    [setSelectedShopNames, shopNames]
  );

  async function handleAction(action: "export" | "feishu-sync" | "sync-feishu" | "retry-failed") {
    if (action !== "retry-failed" && !shopsSanitized.length) {
      message.warning("请先选择店铺");
      return;
    }
    if (action === "export" && (!exportDateRange || !exportDateRange[0] || !exportDateRange[1])) {
      message.warning("请先选择导出日期范围");
      return;
    }

    if (action !== "retry-failed") {
      try {
        window.localStorage.setItem(
          SHOP_SELECTION_CACHE_KEY,
          JSON.stringify(shopsSanitized)
        );
      } catch {}
    }

    const endpoints: Record<string, string> = {
      export: "/api/shop/export",
      "feishu-sync": "/api/shop/feishu-sync",
      "sync-feishu": "/api/shop/sync-feishu",
      "retry-failed": "/api/shop/retry-failed",
    };
    try {
      await startTask(
        endpoints[action],
        action === "retry-failed"
          ? {}
          : action === "export"
            ? {
                shopNames: shopsSanitized,
                startDate: exportDateRange?.[0]?.format("YYYY-MM-DD"),
                endDate: exportDateRange?.[1]?.format("YYYY-MM-DD"),
              }
            : { shopNames: shopsSanitized },
        "shop-export"
      );
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
            value={shopsSanitized}
            onChange={(v) => handleShopSelectChange(v as string[])}
            options={shopSelectOptions}
          />
        </Space>
        <div>
        <Space wrap style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            导出日期：
          </Text>
          {loadingDateRange && !exportDateRange ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              正在加载默认日期...
            </Text>
          ) : (
            <RangePicker
              value={exportDateRange ?? undefined}
              onChange={(value) => {
                if (!value || !value[0] || !value[1]) {
                  setExportDateRange(null);
                  return;
                }
                setExportDateRange([value[0].startOf("day"), value[1].startOf("day")]);
              }}
              allowClear={false}
              format="YYYY-MM-DD"
              disabledDate={(current) =>
                current ? current.isAfter(dayjs().subtract(1, "day").endOf("day")) : false
              }
            />
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            默认按现有规则带出，可手动调整导出区间
          </Text>
        </Space>
        </div>
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
          <Button
            onClick={() => handleAction("retry-failed")}
            disabled={isNamespaceBusy("shop-export")}
          >
            补跑失败项
          </Button>
        </Space>
        </div>
      </div>
    </Space>
  );
}
