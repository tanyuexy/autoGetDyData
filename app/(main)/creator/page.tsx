"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import {
  BarChartOutlined,
  CloudSyncOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { ToolbarMultiSelect } from "@/components/ToolbarMultiSelect";
import { useTaskContext } from "@/contexts/TaskContext";
import { useToolbarMultiSelect } from "@/hooks/useToolbarMultiSelect";
import { SELECT_ALL_CREATOR_EXPORT } from "@/lib/toolbarMultiSelect";
import { semanticTagStyle } from "@/lib/semanticTagStyles";
import type { CreatorAccount } from "@/types";

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;

const CREATOR_SELECTION_CACHE_KEY = "creator:selectedAccounts";

type CreatorInsightItem = {
  id: string;
  recordId: string;
  title: string;
  shopName: string;
  publishTime: string | null;
  publishDate: string | null;
  workType: string;
  reviewStatus: string;
  playCount: number;
  completionRate: number | null;
  fiveSecondCompletionRate: number | null;
  coverClickRate: number | null;
  twoSecondBounceRate: number | null;
  avgPlayDuration: number | null;
  likeCount: number;
  shareCount: number;
  commentCount: number;
  favoriteCount: number;
  profileVisitCount: number;
  followerCount: number;
  salesAmount: number;
  productId: string;
  relatedProduct: string;
  videoLink: string;
  productionTeam: string;
};

type GroupPoint = {
  name: string;
  playCount: number;
  salesAmount: number;
  interactionCount: number;
  itemCount: number;
};

function compactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function plainNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value || 0));
}

function money(value: number) {
  return `¥${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value || 0)}`;
}

function percent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function interactionCount(item: CreatorInsightItem) {
  return item.likeCount + item.shareCount + item.commentCount + item.favoriteCount;
}

function MetricTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="creator-metric-tile">
      <Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Text>
      <div className="creator-metric-value">{value}</div>
      {sub ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {sub}
        </Text>
      ) : null}
    </div>
  );
}

function MiniBarChart({
  data,
  metric,
  emptyText,
}: {
  data: GroupPoint[];
  metric: keyof Pick<GroupPoint, "playCount" | "salesAmount" | "interactionCount" | "itemCount">;
  emptyText: string;
}) {
  const top = data.slice(0, 8);
  const max = Math.max(...top.map((item) => item[metric]), 0);
  if (!top.length || max <= 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }

  return (
    <div className="creator-bar-list">
      {top.map((item) => {
        const width = `${Math.max(5, (item[metric] / max) * 100)}%`;
        return (
          <div className="creator-bar-row" key={item.name}>
            <Tooltip title={item.name}>
              <Text ellipsis className="creator-bar-name">
                {item.name || "未分组"}
              </Text>
            </Tooltip>
            <div className="creator-bar-track" aria-hidden>
              <div className="creator-bar-fill" style={{ width }} />
            </div>
            <Text className="creator-bar-number">
              {metric === "salesAmount" ? money(item[metric]) : compactNumber(item[metric])}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

function TrendChart({ data }: { data: GroupPoint[] }) {
  const points = data.slice(-14);
  const width = 640;
  const height = 150;
  const padX = 28;
  const padY = 18;
  const max = Math.max(...points.map((item) => item.playCount), 0);
  if (points.length < 2 || max <= 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可绘制趋势" />;
  }
  const step = (width - padX * 2) / Math.max(points.length - 1, 1);
  const coords = points.map((item, index) => {
    const x = padX + index * step;
    const y = height - padY - (item.playCount / max) * (height - padY * 2);
    return { x, y, item };
  });
  const d = coords.map((p, index) => `${index === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const fillD = `${d} L ${coords[coords.length - 1].x} ${height - padY} L ${coords[0].x} ${height - padY} Z`;

  return (
    <div className="creator-trend-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="播放量趋势">
        <path d={fillD} fill="rgba(17,17,17,0.06)" />
        <path d={d} fill="none" stroke="var(--vol-primary)" strokeWidth="2.5" strokeLinecap="round" />
        {coords.map((p) => (
          <circle key={p.item.name} cx={p.x} cy={p.y} r="3" fill="var(--vol-primary)" />
        ))}
      </svg>
      <div className="creator-trend-axis">
        <span>{points[0]?.name}</span>
        <span>{points[points.length - 1]?.name}</span>
      </div>
    </div>
  );
}

function groupBy(items: CreatorInsightItem[], key: (item: CreatorInsightItem) => string): GroupPoint[] {
  const map = new Map<string, GroupPoint>();
  for (const item of items) {
    const name = key(item) || "未填写";
    const current =
      map.get(name) ||
      ({
        name,
        playCount: 0,
        salesAmount: 0,
        interactionCount: 0,
        itemCount: 0,
      } satisfies GroupPoint);
    current.playCount += item.playCount || 0;
    current.salesAmount += item.salesAmount || 0;
    current.interactionCount += interactionCount(item);
    current.itemCount += 1;
    map.set(name, current);
  }
  return [...map.values()];
}

export default function CreatorPage() {
  const { message } = App.useApp();
  const [accounts, setAccounts] = useState<CreatorAccount[]>([]);
  const [items, setItems] = useState<CreatorInsightItem[]>([]);
  const [total, setTotal] = useState(0);
  const [lastImportedAt, setLastImportedAt] = useState<string | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [syncingData, setSyncingData] = useState(false);
  const [shopFilter, setShopFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);

  const { startTask, isNamespaceBusy } = useTaskContext();

  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch("/api/creator/list");
      if (!res.ok) throw new Error("获取账号列表失败");
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "获取账号列表失败");
    } finally {
      setLoadingAccounts(false);
    }
  }, [message]);

  const fetchInsights = useCallback(async () => {
    setLoadingData(true);
    try {
      const res = await fetch("/api/creator/insights?limit=2000", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载抖创数据失败");
      setItems(data.items || []);
      setTotal(data.total || 0);
      setLastImportedAt(data.lastImportedAt || null);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "加载抖创数据失败");
    } finally {
      setLoadingData(false);
    }
  }, [message]);

  useEffect(() => {
    void fetchAccounts();
    void fetchInsights();
  }, [fetchAccounts, fetchInsights]);

  const validAccounts = useMemo(
    () => accounts.filter((a) => a.hasStorageState).map((a) => a.name),
    [accounts]
  );

  const toolbarMultiSelect = useToolbarMultiSelect({
    allValues: validAccounts,
    selectAllToken: SELECT_ALL_CREATOR_EXPORT,
    selectAllLabel: validAccounts.length
      ? `全选（${validAccounts.length} 个已登录账号）`
      : "全选（无已登录账号）",
    cacheKey: CREATOR_SELECTION_CACHE_KEY,
    itemOptions: accounts.map((a) => ({
      label: a.name,
      value: a.name,
      disabled: !a.hasStorageState,
    })),
  });

  async function handleTask(action: "export" | "feishu-sync" | "sync-feishu") {
    if (!toolbarMultiSelect.sanitized.length) {
      message.warning("请先选择账号");
      return;
    }

    toolbarMultiSelect.persistSelection(toolbarMultiSelect.sanitized);

    const endpoints: Record<string, string> = {
      export: "/api/creator/export",
      "feishu-sync": "/api/creator/feishu-sync",
      "sync-feishu": "/api/creator/sync-feishu",
    };

    try {
      await startTask(endpoints[action], { accounts: toolbarMultiSelect.sanitized }, "creator-export");
      message.info("任务已启动");
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "启动任务失败");
    }
  }

  async function handleSyncFromFeishu() {
    setSyncingData(true);
    try {
      const res = await fetch("/api/creator/insights", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "同步飞书数据失败");
      message.success(`已从飞书入库 ${data.importedCount || 0} 条记录`);
      await fetchInsights();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "同步飞书数据失败");
    } finally {
      setSyncingData(false);
    }
  }

  const filteredItems = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (shopFilter !== "all" && item.shopName !== shopFilter) return false;
      if (typeFilter !== "all" && item.workType !== typeFilter) return false;
      if (statusFilter !== "all" && item.reviewStatus !== statusFilter) return false;
      if (dateRange && item.publishDate) {
        const d = dayjs(item.publishDate);
        if (d.isBefore(dateRange[0], "day") || d.isAfter(dateRange[1], "day")) return false;
      }
      if (q) {
        const haystack = `${item.title} ${item.shopName} ${item.relatedProduct}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [dateRange, items, keyword, shopFilter, statusFilter, typeFilter]);

  const shopOptions = useMemo(
    () => [
      { label: "全部店铺", value: "all" },
      ...Array.from(new Set(items.map((item) => item.shopName).filter(Boolean))).map((name) => ({
        label: name,
        value: name,
      })),
    ],
    [items]
  );

  const typeOptions = useMemo(
    () => [
      { label: "全部体裁", value: "all" },
      ...Array.from(new Set(items.map((item) => item.workType).filter(Boolean))).map((name) => ({
        label: name,
        value: name,
      })),
    ],
    [items]
  );

  const statusOptions = useMemo(
    () => [
      { label: "全部状态", value: "all" },
      ...Array.from(new Set(items.map((item) => item.reviewStatus).filter(Boolean))).map((name) => ({
        label: name,
        value: name,
      })),
    ],
    [items]
  );

  const metrics = useMemo(() => {
    const count = filteredItems.length;
    const playCount = filteredItems.reduce((sum, item) => sum + (item.playCount || 0), 0);
    const salesAmount = filteredItems.reduce((sum, item) => sum + (item.salesAmount || 0), 0);
    const interactions = filteredItems.reduce((sum, item) => sum + interactionCount(item), 0);
    const avgCompletion =
      filteredItems.reduce((sum, item) => sum + (item.completionRate || 0), 0) /
      Math.max(filteredItems.filter((item) => item.completionRate != null).length, 1);
    return { count, playCount, salesAmount, interactions, avgCompletion };
  }, [filteredItems]);

  const shopRanking = useMemo(
    () => groupBy(filteredItems, (item) => item.shopName).sort((a, b) => b.playCount - a.playCount),
    [filteredItems]
  );

  const typeRanking = useMemo(
    () => groupBy(filteredItems, (item) => item.workType).sort((a, b) => b.itemCount - a.itemCount),
    [filteredItems]
  );

  const dailyTrend = useMemo(
    () => groupBy(filteredItems.filter((item) => item.publishDate), (item) => item.publishDate || "").sort((a, b) => a.name.localeCompare(b.name)),
    [filteredItems]
  );

  const columns = useMemo<TableProps<CreatorInsightItem>["columns"]>(
    () => [
      {
        title: "作品",
        dataIndex: "title",
        width: 320,
        fixed: "left",
        align: "center",
        render: (value: string, item) => (
          <Space
            orientation="vertical"
            size={2}
            style={{ maxWidth: 300, width: "100%", alignItems: "center", textAlign: "center" }}
          >
            <Tooltip title={value}>
              <Text ellipsis style={{ maxWidth: 300, textAlign: "center" }}>
                {value || "-"}
              </Text>
            </Tooltip>
            <Text type="secondary" style={{ fontSize: 12, textAlign: "center" }}>
              {item.relatedProduct || item.productId || "无关联产品"}
            </Text>
          </Space>
        ),
      },
      { title: "店铺", dataIndex: "shopName", width: 150, ellipsis: true, align: "center" },
      { title: "发布时间", dataIndex: "publishTime", width: 150, render: (v) => v || "-", align: "center" },
      {
        title: "体裁",
        dataIndex: "workType",
        width: 100,
        align: "center",
        render: (value: string) => <Tag style={{ margin: 0 }}>{value || "-"}</Tag>,
      },
      {
        title: "状态",
        dataIndex: "reviewStatus",
        width: 92,
        align: "center",
        render: (value: string) => (
          <Tag
            style={{
              margin: 0,
              ...semanticTagStyle(value === "公开" ? "success" : value === "自见" ? "warning" : "default"),
            }}
          >
            {value || "-"}
          </Tag>
        ),
      },
      {
        title: "播放量",
        dataIndex: "playCount",
        width: 110,
        align: "center",
        sorter: (a, b) => a.playCount - b.playCount,
        render: (value: number) => plainNumber(value),
      },
      { title: "完播率", dataIndex: "completionRate", width: 92, render: percent, align: "center" },
      { title: "5秒完播", dataIndex: "fiveSecondCompletionRate", width: 98, render: percent, align: "center" },
      { title: "2秒跳出", dataIndex: "twoSecondBounceRate", width: 98, render: percent, align: "center" },
      {
        title: "互动",
        width: 96,
        align: "center",
        sorter: (a, b) => interactionCount(a) - interactionCount(b),
        render: (_, item) => plainNumber(interactionCount(item)),
      },
      {
        title: "销售额",
        dataIndex: "salesAmount",
        width: 110,
        align: "center",
        sorter: (a, b) => a.salesAmount - b.salesAmount,
        render: (value: number) => money(value),
      },
      { title: "主页访量", dataIndex: "profileVisitCount", width: 100, render: plainNumber, align: "center" },
      { title: "增粉", dataIndex: "followerCount", width: 84, render: plainNumber, align: "center" },
    ],
    []
  );

  const lastImportText = lastImportedAt
    ? dayjs(lastImportedAt).format("YYYY-MM-DD HH:mm")
    : "尚未入库";

  return (
    <div className="app-page-scroll creator-dashboard-page">
      <div className="creator-page-header">
        <div>
          <Title level={3} style={{ margin: 0, fontSize: 18 }}>
            抖创数据
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            已入库 {plainNumber(total)} 条，最近同步：{lastImportText}
          </Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void fetchInsights()} loading={loadingData}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<CloudSyncOutlined />}
            onClick={() => void handleSyncFromFeishu()}
            loading={syncingData}
          >
            从飞书入库
          </Button>
        </Space>
      </div>

      <div className="creator-action-band">
        <Space wrap size={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            抖创账号：
          </Text>
          <ToolbarMultiSelect
            value={toolbarMultiSelect.sanitized}
            onChange={toolbarMultiSelect.handleChange}
            options={toolbarMultiSelect.selectOptions}
            placeholder="选择已登录账号"
            minWidth={300}
          />
          <Button
            className="creator-action-button"
            icon={<DownloadOutlined />}
            onClick={() => void handleTask("export")}
            disabled={loadingAccounts || isNamespaceBusy("creator-export")}
          >
            导出
          </Button>
          <Button
            className="creator-action-button"
            icon={<CloudSyncOutlined />}
            onClick={() => void handleTask("feishu-sync")}
            disabled={loadingAccounts || isNamespaceBusy("creator-export")}
          >
            推送飞书
          </Button>
          <Button
            className="creator-action-button creator-action-button-danger"
            danger
            icon={<SendOutlined />}
            onClick={() => void handleTask("sync-feishu")}
            disabled={loadingAccounts || isNamespaceBusy("creator-export")}
          >
            导出并推送
          </Button>
        </Space>
      </div>

      <div className="creator-filter-row">
        <Select value={shopFilter} onChange={setShopFilter} options={shopOptions} showSearch style={{ width: 190 }} />
        <Select value={typeFilter} onChange={setTypeFilter} options={typeOptions} style={{ width: 130 }} />
        <Select value={statusFilter} onChange={setStatusFilter} options={statusOptions} style={{ width: 130 }} />
        <RangePicker
          value={dateRange ?? undefined}
          onChange={(value) => {
            if (!value || !value[0] || !value[1]) {
              setDateRange(null);
              return;
            }
            setDateRange([value[0].startOf("day"), value[1].startOf("day")]);
          }}
        />
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索作品 / 商品"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 240 }}
        />
      </div>

      <div className="creator-metric-grid">
        <MetricTile label="作品数" value={plainNumber(metrics.count)} sub={`筛选后 / 总 ${plainNumber(total)}`} />
        <MetricTile label="播放量" value={compactNumber(metrics.playCount)} sub={plainNumber(metrics.playCount)} />
        <MetricTile label="互动量" value={compactNumber(metrics.interactions)} sub="赞评藏转合计" />
        <MetricTile label="销售额" value={money(metrics.salesAmount)} sub="按飞书销售额字段汇总" />
        <MetricTile label="平均完播率" value={percent(metrics.avgCompletion)} sub="仅统计有完播率记录" />
      </div>

      <div className="creator-chart-grid">
        <section className="creator-chart-panel">
          <div className="creator-panel-title">
            <BarChartOutlined />
            <span>播放趋势</span>
          </div>
          <TrendChart data={dailyTrend} />
        </section>
        <section className="creator-chart-panel">
          <div className="creator-panel-title">
            <BarChartOutlined />
            <span>店铺播放排行</span>
          </div>
          <MiniBarChart data={shopRanking} metric="playCount" emptyText="暂无店铺数据" />
        </section>
        <section className="creator-chart-panel">
          <div className="creator-panel-title">
            <BarChartOutlined />
            <span>体裁分布</span>
          </div>
          <MiniBarChart data={typeRanking} metric="itemCount" emptyText="暂无体裁数据" />
        </section>
      </div>

      <div className="creator-table-wrap">
        <Table
          rowKey="recordId"
          size="small"
          bordered={false}
          loading={loadingData}
          dataSource={filteredItems}
          columns={columns}
          tableLayout="fixed"
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (count) => `共 ${count} 条` }}
          scroll={{ x: "max-content" }}
          sticky
          locale={{ emptyText: "暂无抖创数据，请点击「从飞书入库」" }}
        />
      </div>
    </div>
  );
}
