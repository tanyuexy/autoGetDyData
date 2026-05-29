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
  Spin,
  Table,
  Tag,
  Tabs,
  Tooltip,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import type { EChartsOption } from "echarts";
import {
  BarChartOutlined,
  CloudSyncOutlined,
  DownloadOutlined,
  SearchOutlined,
  SendOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import ReactECharts from "echarts-for-react";
import { ToolbarMultiSelect } from "@/components/ToolbarMultiSelect";
import { useTaskContext } from "@/contexts/TaskContext";
import { useToolbarMultiSelect } from "@/hooks/useToolbarMultiSelect";
import { SELECT_ALL_CREATOR_EXPORT } from "@/lib/toolbarMultiSelect";
import { semanticTagStyle } from "@/lib/semanticTagStyles";
import type { CreatorInsightItem } from "@/lib/creator/insights-types";
import { sumShopSalesEntries } from "@/lib/creator/insights-types";
import {
  buildCreatorInsightsSearchParams,
  CREATOR_INSIGHTS_TABLE_PAGE_SIZE,
} from "@/lib/creator/insights-query";
import type {
  CreatorInsightsGroupPoint,
  CreatorInsightsSummaryResult,
} from "@/lib/creator/insights-summary";
import {
  readCreatorInsightsFiltersCache,
  writeCreatorInsightsFiltersCache,
  type CreatorInsightsDatePreset,
  type CreatorInsightsFiltersCache,
} from "@/lib/creator/insights-filter-cache";
import type { CreatorAccount } from "@/types";

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;

const CREATOR_SELECTION_CACHE_KEY = "creator:selectedAccounts";

type DatePreset = CreatorInsightsDatePreset;

const DATE_PRESET_OPTIONS: { label: string; value: DatePreset }[] = [
  { label: "全部日期", value: "all" },
  { label: "今天", value: "today" },
  { label: "明天", value: "tomorrow" },
  { label: "昨天", value: "yesterday" },
  { label: "过去 7 天内", value: "last7" },
  { label: "本周", value: "thisWeek" },
  { label: "上周", value: "lastWeek" },
  { label: "本月", value: "thisMonth" },
  { label: "上月", value: "lastMonth" },
  { label: "自定义范围", value: "custom" },
];

type GroupPoint = CreatorInsightsGroupPoint;

const EMPTY_SUMMARY: CreatorInsightsSummaryResult = {
  metrics: {
    count: 0,
    playCount: 0,
    interactions: 0,
    avgCompletion: 0,
    cumulativeSalesAmount: 0,
    periodSalesAmount: 0,
  },
  shopRanking: [],
  typeRanking: [],
  dailyTrend: [],
  shopSalesDailyTrend: [],
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

function formatMetricValue(
  metric: keyof Pick<GroupPoint, "playCount" | "salesAmount" | "interactionCount" | "itemCount">,
  value: number
) {
  if (metric === "salesAmount") return money(value);
  return compactNumber(value);
}

function percent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function interactionCount(item: CreatorInsightItem) {
  return item.likeCount + item.shareCount + item.commentCount + item.favoriteCount;
}

function dateRangeFromPreset(preset: DatePreset): [Dayjs, Dayjs] | null {
  const today = dayjs();
  switch (preset) {
    case "today":
      return [today.startOf("day"), today.startOf("day")];
    case "tomorrow": {
      const tomorrow = today.add(1, "day");
      return [tomorrow.startOf("day"), tomorrow.startOf("day")];
    }
    case "yesterday": {
      const yesterday = today.subtract(1, "day");
      return [yesterday.startOf("day"), yesterday.startOf("day")];
    }
    case "last7":
      return [today.subtract(6, "day").startOf("day"), today.startOf("day")];
    case "thisWeek":
      return [today.startOf("week"), today.startOf("day")];
    case "lastWeek": {
      const lastWeek = today.subtract(1, "week");
      return [lastWeek.startOf("week"), lastWeek.endOf("week").startOf("day")];
    }
    case "thisMonth":
      return [today.startOf("month"), today.startOf("day")];
    case "lastMonth": {
      const lastMonth = today.subtract(1, "month");
      return [lastMonth.startOf("month"), lastMonth.endOf("month").startOf("day")];
    }
    case "all":
    case "custom":
    default:
      return null;
  }
}

function dateRangeFromFiltersCache(cached: CreatorInsightsFiltersCache): [Dayjs, Dayjs] | null {
  if (cached.datePreset === "custom") {
    if (!cached.customDateStart || !cached.customDateEnd) return null;
    const start = dayjs(cached.customDateStart, "YYYY-MM-DD");
    const end = dayjs(cached.customDateEnd, "YYYY-MM-DD");
    if (!start.isValid() || !end.isValid()) return null;
    return [start.startOf("day"), end.startOf("day")];
  }
  return dateRangeFromPreset(cached.datePreset);
}

function MetricTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "volume" | "engagement" | "sales" | "publishSales" | "rate";
}) {
  return (
    <div className={`creator-metric-tile creator-metric-tile-${tone}`}>
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

function ChartEmpty({ text }: { text: string }) {
  return (
    <div className="creator-chart-empty">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />
    </div>
  );
}

function formatChartDayLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[3]}` : value;
}

const CREATOR_CHART_COLORS = {
  sales: "#2563eb",
  salesLight: "#7dd3fc",
  play: "#0f766e",
  playLight: "#5eead4",
  rank: "#4f46e5",
  rankLight: "#c4b5fd",
  count: "#be185d",
  countLight: "#f9a8d4",
  neutralText: "#3f3a34",
  axisText: "#7a736b",
  gridLine: "rgba(78,91,112,0.12)",
  track: "#e7edf3",
};

function chartLinearColor(from: string, to: string) {
  return {
    type: "linear" as const,
    x: 0,
    y: 0,
    x2: 1,
    y2: 0,
    colorStops: [
      { offset: 0, color: from },
      { offset: 1, color: to },
    ],
  };
}

function chartVerticalColor(from: string, to: string) {
  return {
    type: "linear" as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: from },
      { offset: 1, color: to },
    ],
  };
}

function CreatorChart({ option }: { option: EChartsOption }) {
  return (
    <ReactECharts
      option={option}
      notMerge
      lazyUpdate
      style={{ width: "100%", height: "100%", minHeight: 0 }}
      opts={{ renderer: "svg" }}
    />
  );
}

function MiniBarChart({
  data,
  metric,
  emptyText,
  scrollable = false,
  maxVisibleRows = 8,
  labelWidth,
}: {
  data: GroupPoint[];
  metric: keyof Pick<GroupPoint, "playCount" | "salesAmount" | "interactionCount" | "itemCount">;
  emptyText: string;
  scrollable?: boolean;
  maxVisibleRows?: number;
  labelWidth?: number;
}) {
  const option = useMemo<EChartsOption | null>(() => {
    const max = Math.max(...data.map((item) => item[metric]), 0);
    if (!data.length || max <= 0) return null;
    const axisMax = max * 1.18;
    const colorFrom = metric === "itemCount" ? CREATOR_CHART_COLORS.countLight : CREATOR_CHART_COLORS.rankLight;
    const colorTo = metric === "itemCount" ? CREATOR_CHART_COLORS.count : CREATOR_CHART_COLORS.rank;

    return {
      animation: true,
      animationDuration: 700,
      animationDurationUpdate: 360,
      animationEasing: "cubicOut",
      animationDelay: (index: number) => index * 45,
      grid: {
        top: 6,
        right: 18,
        bottom: 4,
        left: 6,
        containLabel: true,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(255,255,255,0.98)",
        borderColor: "#e0dbd5",
        textStyle: { color: "#2f2b28", fontSize: 12 },
        formatter(params: unknown) {
          const row = Array.isArray(params) ? params[0] : params;
          if (!row || typeof row !== "object") return emptyText;
          const datum = row as { axisValueLabel?: string; value?: number };
          return `${datum.axisValueLabel || "未分组"}<br/>${formatMetricValue(metric, Number(datum.value || 0))}`;
        },
      },
      xAxis: {
        type: "value",
        show: false,
        max: axisMax,
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: data.map((item) => item.name || "未分组"),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#2f2b28",
          fontSize: 12,
          width: labelWidth ?? (scrollable ? 156 : 112),
          overflow: "break",
        },
      },
      dataZoom: scrollable
        ? [
            {
              type: "inside",
              yAxisIndex: 0,
              startValue: 0,
              endValue: Math.min(maxVisibleRows - 1, data.length - 1),
              zoomOnMouseWheel: false,
              moveOnMouseWheel: true,
              moveOnMouseMove: true,
              filterMode: "empty",
            },
            {
              type: "slider",
              yAxisIndex: 0,
              show: false,
              startValue: 0,
              endValue: Math.min(maxVisibleRows - 1, data.length - 1),
              filterMode: "empty",
            },
          ]
        : undefined,
      series: [
        {
          type: "bar",
          data: data.map((item) => item[metric]),
          barWidth: 7,
          itemStyle: {
            color: chartLinearColor(colorFrom, colorTo),
            borderRadius: [999, 999, 999, 999],
          },
          label: {
            show: true,
            position: "right",
            distance: 10,
            color: CREATOR_CHART_COLORS.neutralText,
            fontSize: 12,
            formatter: ((params: any) => formatMetricValue(metric, Number(params?.value || 0))) as any,
          },
          showBackground: true,
          backgroundStyle: {
            color: CREATOR_CHART_COLORS.track,
            borderRadius: [999, 999, 999, 999],
          },
        },
      ],
    };
  }, [data, emptyText, labelWidth, maxVisibleRows, metric, scrollable]);

  if (!option) {
    return <ChartEmpty text={emptyText} />;
  }

  return <CreatorChart option={option} />;
}

function TrendChart({ data }: { data: GroupPoint[] }) {
  const points = data;
  const option = useMemo<EChartsOption | null>(() => {
    const max = Math.max(...points.map((item) => item.playCount), 0);
    if (points.length < 2 || max <= 0) return null;

    return {
      animation: true,
      animationDuration: 900,
      animationDurationUpdate: 420,
      animationEasing: "cubicOut",
      grid: {
        top: 8,
        right: 16,
        bottom: 8,
        left: 8,
        containLabel: true,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "line",
          lineStyle: {
            color: "rgba(15,118,110,0.24)",
            type: "dashed",
          },
        },
        backgroundColor: "rgba(255,255,255,0.98)",
        borderColor: "#e0dbd5",
        textStyle: { color: "#2f2b28", fontSize: 12 },
        formatter(params: unknown) {
          const row = Array.isArray(params) ? params[0] : params;
          if (!row || typeof row !== "object") return "暂无数据";
          const datum = row as { axisValueLabel?: string; value?: number };
          return `${datum.axisValueLabel || ""}<br/>播放量 ${plainNumber(Number(datum.value || 0))}`;
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: points.map((item) => item.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
      },
      yAxis: {
        type: "value",
        show: false,
      },
      series: [
        {
          type: "line",
          data: points.map((item) => item.playCount),
          smooth: false,
          symbol: "circle",
          symbolSize: 6,
          lineStyle: {
            color: CREATOR_CHART_COLORS.play,
            width: 2.5,
          },
          itemStyle: {
            color: CREATOR_CHART_COLORS.play,
          },
          areaStyle: {
            color: chartVerticalColor("rgba(15,118,110,0.2)", "rgba(15,118,110,0.03)"),
          },
        },
      ],
    };
  }, [points]);

  if (!option) {
    return <ChartEmpty text="暂无可绘制趋势" />;
  }

  return (
    <div className="creator-trend-chart">
      <div className="creator-trend-chart-body">
        <CreatorChart option={option} />
      </div>
      <div className="creator-trend-axis">
        <span>{points[0]?.name}</span>
        <span>{points[points.length - 1]?.name}</span>
      </div>
    </div>
  );
}

function DailyMetricBarChart({
  data,
  metric,
  emptyText,
  showAverageLine = false,
}: {
  data: GroupPoint[];
  metric: keyof Pick<GroupPoint, "playCount" | "salesAmount" | "interactionCount" | "itemCount">;
  emptyText: string;
  /** 区间销售额等场景：展示日均水平虚线 */
  showAverageLine?: boolean;
}) {
  const option = useMemo<EChartsOption | null>(() => {
    if (!data.length) return null;
    const values = data.map((item) => item[metric]);
    const max = Math.max(...values, 0);
    if (max <= 0) return null;

    const denseAxis = data.length > 12;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const averageLabel =
      metric === "salesAmount" ? `日均 ${money(average)}` : `日均 ${formatMetricValue(metric, average)}`;

    return {
      animation: true,
      animationDuration: 850,
      animationDurationUpdate: 420,
      animationEasing: "cubicOut",
      animationDelay: (index: number) => index * 24,
      grid: {
        top: showAverageLine ? 28 : 18,
        right: showAverageLine ? 72 : 12,
        bottom: denseAxis ? 28 : 20,
        left: 8,
        containLabel: true,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(255,255,255,0.98)",
        borderColor: "#e0dbd5",
        textStyle: { color: "#2f2b28", fontSize: 12 },
        formatter(params: unknown) {
          const row = Array.isArray(params) ? params[0] : params;
          if (!row || typeof row !== "object") return emptyText;
          const datum = row as { axisValueLabel?: string; value?: number };
          return `${datum.axisValueLabel || ""}<br/>${formatMetricValue(metric, Number(datum.value || 0))}`;
        },
      },
      xAxis: {
        type: "category",
        data: data.map((item) => item.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: CREATOR_CHART_COLORS.axisText,
          fontSize: 11,
          rotate: denseAxis ? 35 : 0,
          margin: 6,
          hideOverlap: !denseAxis,
          formatter: (value: string) => formatChartDayLabel(value),
        },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          lineStyle: {
            color: CREATOR_CHART_COLORS.gridLine,
          },
        },
        axisLabel: {
          color: "#8a837d",
          fontSize: 11,
          formatter: (value: number) => (metric === "salesAmount" ? `${Math.round(value)}` : compactNumber(value)),
        },
      },
      series: [
        {
          type: "bar",
          data: values,
          barWidth: "48%",
          itemStyle: {
            color: chartVerticalColor(CREATOR_CHART_COLORS.salesLight, CREATOR_CHART_COLORS.sales),
            borderRadius: [5, 5, 0, 0],
          },
          label: {
            show: true,
            position: "top",
            color: CREATOR_CHART_COLORS.sales,
            fontSize: 11,
            distance: 6,
            formatter: ((params: any) => {
              const value = Number(params?.value || 0);
              return value > 0 ? formatMetricValue(metric, value) : "";
            }) as any,
          },
          markLine: showAverageLine
            ? {
                silent: true,
                symbol: ["none", "none"],
                lineStyle: {
                  type: "dashed",
                  color: "rgba(37, 99, 235, 0.55)",
                  width: 1.5,
                },
                label: {
                  show: true,
                  formatter: averageLabel,
                  color: CREATOR_CHART_COLORS.sales,
                  fontSize: 11,
                  position: "insideEndTop",
                },
                data: [{ yAxis: average, name: "日均" }],
              }
            : undefined,
        },
      ],
    };
  }, [data, emptyText, metric, showAverageLine]);

  if (!option) {
    return <ChartEmpty text={emptyText} />;
  }

  return <CreatorChart option={option} />;
}


function insightsFilterQuery(params: {
  shopFilter: string;
  typeFilter: string;
  statusFilter: string;
  productionTeamFilter: string[];
  keyword: string;
  dateRange: [Dayjs, Dayjs] | null;
  page?: number;
}) {
  return buildCreatorInsightsSearchParams({
    shop: params.shopFilter,
    workType: params.typeFilter,
    status: params.statusFilter,
    teams: params.productionTeamFilter,
    keyword: params.keyword,
    dateStart: params.dateRange?.[0]?.format("YYYY-MM-DD") ?? null,
    dateEnd: params.dateRange?.[1]?.format("YYYY-MM-DD") ?? null,
    page: params.page,
  });
}

export default function CreatorPage() {
  const { message } = App.useApp();
  const [accounts, setAccounts] = useState<CreatorAccount[]>([]);
  const [tableItems, setTableItems] = useState<CreatorInsightItem[]>([]);
  const [tablePage, setTablePage] = useState(1);
  const [tableFilteredTotal, setTableFilteredTotal] = useState(0);
  const [dbTotal, setDbTotal] = useState(0);
  const [lastImportedAt, setLastImportedAt] = useState<string | null>(null);
  const [summary, setSummary] = useState<CreatorInsightsSummaryResult>(EMPTY_SUMMARY);
  const [facets, setFacets] = useState({
    shops: [] as string[],
    workTypes: [] as string[],
    reviewStatuses: [] as string[],
    productionTeams: [] as string[],
  });
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingTable, setLoadingTable] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingFacets, setLoadingFacets] = useState(true);
  const [syncingData, setSyncingData] = useState(false);
  const [shopFilter, setShopFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [productionTeamFilter, setProductionTeamFilter] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [keywordDebounced, setKeywordDebounced] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("thisMonth");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(() => dateRangeFromPreset("thisMonth"));
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  const { startTask, isNamespaceBusy } = useTaskContext();

  useEffect(() => {
    const cached = readCreatorInsightsFiltersCache();
    if (cached) {
      setShopFilter(cached.shopFilter);
      setTypeFilter(cached.typeFilter);
      setStatusFilter(cached.statusFilter);
      setProductionTeamFilter(cached.productionTeamFilter);
      setKeyword(cached.keyword);
      setDatePreset(cached.datePreset);
      setDateRange(dateRangeFromFiltersCache(cached));
    }
    setFiltersHydrated(true);
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;
    writeCreatorInsightsFiltersCache({
      shopFilter,
      typeFilter,
      statusFilter,
      productionTeamFilter,
      keyword,
      datePreset,
      customDateStart: datePreset === "custom" ? dateRange?.[0]?.format("YYYY-MM-DD") ?? null : null,
      customDateEnd: datePreset === "custom" ? dateRange?.[1]?.format("YYYY-MM-DD") ?? null : null,
    });
  }, [
    datePreset,
    dateRange,
    filtersHydrated,
    keyword,
    productionTeamFilter,
    shopFilter,
    statusFilter,
    typeFilter,
  ]);

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

  const filterParams = useMemo(
    () => ({
      shopFilter,
      typeFilter,
      statusFilter,
      productionTeamFilter,
      keyword: keywordDebounced,
      dateRange,
    }),
    [
      dateRange,
      keywordDebounced,
      productionTeamFilter,
      shopFilter,
      statusFilter,
      typeFilter,
    ]
  );

  const fetchFacets = useCallback(async () => {
    setLoadingFacets(true);
    try {
      const res = await fetch("/api/creator/insights/facets", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载筛选项失败");
      setFacets({
        shops: data.shops || [],
        workTypes: data.workTypes || [],
        reviewStatuses: data.reviewStatuses || [],
        productionTeams: data.productionTeams || [],
      });
      setDbTotal(data.dbTotal || 0);
      setLastImportedAt(data.lastImportedAt || null);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "加载筛选项失败");
    } finally {
      setLoadingFacets(false);
    }
  }, [message]);

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const query = insightsFilterQuery(filterParams).toString();
      const res = await fetch(`/api/creator/insights/summary?${query}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载汇总数据失败");
      setSummary({
        metrics: data.metrics || EMPTY_SUMMARY.metrics,
        shopRanking: data.shopRanking || [],
        typeRanking: data.typeRanking || [],
        dailyTrend: data.dailyTrend || [],
        shopSalesDailyTrend: data.shopSalesDailyTrend || [],
      });
      setDbTotal(data.dbTotal ?? 0);
      setLastImportedAt(data.lastImportedAt || null);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "加载汇总数据失败");
    } finally {
      setLoadingSummary(false);
    }
  }, [filterParams, message]);

  const fetchTablePage = useCallback(
    async (page: number) => {
      setLoadingTable(true);
      try {
        const query = insightsFilterQuery({ ...filterParams, page }).toString();
        const res = await fetch(`/api/creator/insights?${query}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "加载表格数据失败");
        setTableItems(data.items || []);
        setTablePage(data.page || page);
        setTableFilteredTotal(data.filteredTotal || 0);
        setDbTotal(data.dbTotal ?? 0);
        setLastImportedAt(data.lastImportedAt || null);
      } catch (e: unknown) {
        message.error(e instanceof Error ? e.message : "加载表格数据失败");
      } finally {
        setLoadingTable(false);
      }
    },
    [filterParams, message]
  );

  useEffect(() => {
    void fetchAccounts();
    void fetchFacets();
  }, [fetchAccounts, fetchFacets]);

  useEffect(() => {
    const timer = window.setTimeout(() => setKeywordDebounced(keyword), 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    if (!filtersHydrated) return;
    setTablePage(1);
    void fetchSummary();
    void fetchTablePage(1);
  }, [filterParams, filtersHydrated, fetchSummary, fetchTablePage]);

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
      message.success(
        `已从飞书入库 ${data.importedCount || 0} 条作品，${data.shopMatchedCount || 0} 条已关联抖店成交明细`
      );
      await Promise.all([fetchFacets(), fetchSummary(), fetchTablePage(1)]);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : "同步飞书数据失败");
    } finally {
      setSyncingData(false);
    }
  }

  function handleDatePresetChange(value: DatePreset) {
    setDatePreset(value);
    if (value !== "custom") {
      setDateRange(dateRangeFromPreset(value));
    }
  }

  const salesDateRange = useMemo(() => {
    if (!dateRange) return null;
    return {
      start: dateRange[0].format("YYYY-MM-DD"),
      end: dateRange[1].format("YYYY-MM-DD"),
    };
  }, [dateRange]);

  const shopOptions = useMemo(
    () => [
      { label: "全部店铺", value: "all" },
      ...facets.shops.map((name) => ({ label: name, value: name })),
    ],
    [facets.shops]
  );

  const typeOptions = useMemo(
    () => [
      { label: "全部体裁", value: "all" },
      ...facets.workTypes.map((name) => ({ label: name, value: name })),
    ],
    [facets.workTypes]
  );

  const statusOptions = useMemo(
    () => [
      { label: "全部状态", value: "all" },
      ...facets.reviewStatuses.map((name) => ({ label: name, value: name })),
    ],
    [facets.reviewStatuses]
  );

  const productionTeamOptions = useMemo(
    () => facets.productionTeams.map((name) => ({ label: name, value: name })),
    [facets.productionTeams]
  );

  const metrics = summary.metrics;
  const shopRanking = summary.shopRanking;
  const typeRanking = summary.typeRanking;
  const dailyTrend = summary.dailyTrend;
  const shopSalesDailyTrend = summary.shopSalesDailyTrend;

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
      { title: "制作团队", dataIndex: "productionTeam", width: 160, ellipsis: true, align: "center", render: (v) => v || "-" },
      { title: "发布时间", dataIndex: "publishTime", width: 150, render: (v) => v || "-", align: "center" },
      {
        title: "体裁",
        dataIndex: "workType",
        width: 100,
        align: "center",
        render: (value: string) => <Tag style={{ margin: 0 }}>{value || "-"}</Tag>,
      },
      {
        title: "类型",
        dataIndex: "creationType",
        width: 108,
        align: "center",
        render: (value: string) => (
          <Tag
            style={{
              margin: 0,
              ...semanticTagStyle(
                value === "实拍"
                  ? "success"
                  : value === "AI创作"
                    ? "processing"
                    : "default"
              ),
            }}
          >
            {value || "-"}
          </Tag>
        ),
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
        title: "累积销售额",
        dataIndex: "salesAmount",
        width: 118,
        align: "center",
        sorter: (a, b) => a.salesAmount - b.salesAmount,
        render: (value: number) => money(value),
      },
      {
        title: "区间销售额",
        width: 118,
        align: "center",
        sorter: (a, b) =>
          sumShopSalesEntries(a.shopSalesEntries, salesDateRange) -
          sumShopSalesEntries(b.shopSalesEntries, salesDateRange),
        render: (_, item) => money(sumShopSalesEntries(item.shopSalesEntries, salesDateRange)),
      },
      { title: "主页访量", dataIndex: "profileVisitCount", width: 100, render: plainNumber, align: "center" },
      { title: "增粉", dataIndex: "followerCount", width: 84, render: plainNumber, align: "center" },
    ],
    [salesDateRange]
  );

  const lastImportText = lastImportedAt
    ? dayjs(lastImportedAt).format("YYYY-MM-DD HH:mm")
    : "尚未入库";

  return (
    <div className="app-page-scroll creator-dashboard-page">
      <div className="creator-page-header creator-page-header-single">
        <div className="creator-page-header-leading">
          <div className="creator-page-header-meta">
            <Title level={3} className="creator-page-title" style={{ margin: 0, fontSize: 16 }}>
              抖创数据
            </Title>
            <Text type="secondary" className="creator-page-subtitle" style={{ fontSize: 11 }}>
              已入库 {plainNumber(dbTotal)} 条 · 同步 {lastImportText}
            </Text>
          </div>
          <Button
            size="small"
            type="primary"
            icon={<CloudSyncOutlined />}
            onClick={() => void handleSyncFromFeishu()}
            loading={syncingData}
          >
            从飞书入库
          </Button>
        </div>
        <div className="creator-page-header-toolbar">
          <div className="creator-page-header-account">
            <Text type="secondary" className="creator-page-header-account-label">
              导出账号
            </Text>
            <ToolbarMultiSelect
              value={toolbarMultiSelect.sanitized}
              onChange={toolbarMultiSelect.handleChange}
              options={toolbarMultiSelect.selectOptions}
              placeholder="选择已登录账号"
              minWidth={200}
              size="small"
              maxTagCount={2}
            />
          </div>
          <Space wrap size={8} className="creator-page-header-actions">
            <Button
              size="small"
              className="creator-action-button"
              icon={<DownloadOutlined />}
              onClick={() => void handleTask("export")}
              disabled={loadingAccounts || isNamespaceBusy("creator-export")}
            >
              导出
            </Button>
            <Button
              size="small"
              className="creator-action-button"
              icon={<CloudSyncOutlined />}
              onClick={() => void handleTask("feishu-sync")}
              disabled={loadingAccounts || isNamespaceBusy("creator-export")}
            >
              推送飞书
            </Button>
            <Button
              size="small"
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
      </div>

      <div className="creator-filter-row">
        <Select
          value={shopFilter}
          onChange={setShopFilter}
          options={shopOptions}
          showSearch
          loading={loadingFacets}
          style={{ width: 190 }}
        />
        <Select value={typeFilter} onChange={setTypeFilter} options={typeOptions} loading={loadingFacets} style={{ width: 130 }} />
        <Select value={statusFilter} onChange={setStatusFilter} options={statusOptions} loading={loadingFacets} style={{ width: 130 }} />
        <Select
          mode="multiple"
          allowClear
          value={productionTeamFilter}
          onChange={setProductionTeamFilter}
          options={productionTeamOptions}
          placeholder="制作团队"
          maxTagCount="responsive"
          loading={loadingFacets}
          style={{ width: 220 }}
        />
        <Select
          value={datePreset}
          onChange={handleDatePresetChange}
          options={DATE_PRESET_OPTIONS}
          style={{ width: 150 }}
        />
        {datePreset === "custom" ? (
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
        ) : null}
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索作品 / 商品"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 240 }}
        />
      </div>

      <Spin spinning={loadingSummary}>
      <div className="creator-metric-grid">
        <MetricTile
          label="作品数"
          value={plainNumber(metrics.count)}
          sub={`筛选后 / 总 ${plainNumber(dbTotal)}`}
          tone="neutral"
        />
        <MetricTile label="播放量" value={compactNumber(metrics.playCount)} sub={plainNumber(metrics.playCount)} tone="volume" />
        <MetricTile label="互动量" value={compactNumber(metrics.interactions)} sub="赞评藏转合计" tone="engagement" />
        <MetricTile
          label="区间销售额"
          value={money(metrics.periodSalesAmount)}
          tone="sales"
          sub={
            dateRange
              ? `${dateRange[0].format("MM-DD")} ~ ${dateRange[1].format("MM-DD")} 销售额`
              : "按抖店成交日期汇总（不受发布日期筛选）"
          }
        />
        <MetricTile
          label="日期内发布作品销售额"
          value={money(metrics.cumulativeSalesAmount)}
          sub="筛选日期内发布作品的销售额"
          tone="publishSales"
        />
        <MetricTile label="平均完播率" value={percent(metrics.avgCompletion)} sub="仅统计有完播率记录" tone="rate" />
      </div>
      </Spin>

      <div className="creator-data-tabs">
        <Tabs
          defaultActiveKey="charts"
          items={[
            {
              key: "charts",
              label: "图表概览",
              children: (
                <Spin spinning={loadingSummary}>
                <div className="creator-chart-stack">
                  <section className="creator-chart-panel creator-chart-panel-wide creator-chart-panel-sales">
                    <div className="creator-panel-title">
                      <BarChartOutlined />
                      <span>区间销售额</span>
                    </div>
                    <div className="creator-chart-body creator-chart-body-wide">
                      <DailyMetricBarChart
                        data={shopSalesDailyTrend}
                        metric="salesAmount"
                        showAverageLine
                        emptyText="当前筛选范围暂无可绘制区间销售额数据"
                      />
                    </div>
                  </section>

                  <div className="creator-chart-grid">
                    <section className="creator-chart-panel creator-chart-panel-play">
                      <div className="creator-panel-title">
                        <BarChartOutlined />
                        <span>播放趋势</span>
                      </div>
                      <div className="creator-chart-body">
                        <TrendChart data={dailyTrend} />
                      </div>
                    </section>
                    <section className="creator-chart-panel creator-chart-panel-rank">
                      <div className="creator-panel-title">
                        <BarChartOutlined />
                        <span>店铺播放排行</span>
                      </div>
                      <div className="creator-chart-body">
                        <MiniBarChart
                          data={shopRanking}
                          metric="playCount"
                          emptyText="暂无店铺数据"
                          scrollable
                          maxVisibleRows={5}
                          labelWidth={164}
                        />
                      </div>
                    </section>
                    <section className="creator-chart-panel creator-chart-panel-type">
                      <div className="creator-panel-title">
                        <BarChartOutlined />
                        <span>体裁分布</span>
                      </div>
                      <div className="creator-chart-body">
                        <MiniBarChart
                          data={typeRanking}
                          metric="itemCount"
                          emptyText="暂无体裁数据"
                          labelWidth={92}
                        />
                      </div>
                    </section>
                  </div>
                </div>
                </Spin>
              ),
            },
            {
              key: "table",
              label: "数据明细",
              children: (
                <div className="creator-table-wrap">
                  <Table
                    rowKey="recordId"
                    size="small"
                    bordered={false}
                    loading={loadingTable}
                    dataSource={tableItems}
                    columns={columns}
                    tableLayout="fixed"
                    pagination={{
                      current: tablePage,
                      pageSize: CREATOR_INSIGHTS_TABLE_PAGE_SIZE,
                      total: tableFilteredTotal,
                      showSizeChanger: false,
                      showTotal: (count) => `共 ${count} 条`,
                      onChange: (page) => void fetchTablePage(page),
                    }}
                    scroll={{ x: "max-content" }}
                    sticky
                    locale={{ emptyText: "暂无抖创数据，请点击「从飞书入库」" }}
                  />
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
