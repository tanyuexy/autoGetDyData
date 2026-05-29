import type { Filter } from "mongodb";

export const CREATOR_INSIGHTS_TABLE_PAGE_SIZE = 20;

export type CreatorInsightsQueryParams = {
  shop: string;
  workType: string;
  creationType: string;
  status: string;
  teams: string[];
  keyword: string;
  dateStart: string | null;
  dateEnd: string | null;
  page: number;
  pageSize: number;
};

export function parseCreatorInsightsQuery(searchParams: URLSearchParams): CreatorInsightsQueryParams {
  const teamsRaw = searchParams.get("teams") || "";
  const teams = teamsRaw
    ? teamsRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const page = Math.max(Number(searchParams.get("page") || 1), 1);
  const pageSize = CREATOR_INSIGHTS_TABLE_PAGE_SIZE;
  return {
    shop: (searchParams.get("shop") || "all").trim(),
    workType: (searchParams.get("workType") || "all").trim(),
    creationType: (searchParams.get("creationType") || "all").trim(),
    status: (searchParams.get("status") || "all").trim(),
    teams,
    keyword: (searchParams.get("keyword") || "").trim(),
    dateStart: (searchParams.get("dateStart") || "").trim() || null,
    dateEnd: (searchParams.get("dateEnd") || "").trim() || null,
    page,
    pageSize,
  };
}

export function buildCreatorInsightsMongoFilter(
  params: Pick<
    CreatorInsightsQueryParams,
    "shop" | "workType" | "creationType" | "status" | "teams" | "keyword" | "dateStart" | "dateEnd"
  >,
  options: { includePublishDate?: boolean } = {}
): Filter<Record<string, unknown>> {
  const filter: Filter<Record<string, unknown>> = {};

  if (params.shop !== "all" && params.shop) {
    filter.shopName = params.shop;
  }
  if (params.workType !== "all" && params.workType) {
    filter.workType = params.workType;
  }
  if (params.creationType !== "all" && params.creationType) {
    filter.creationType = params.creationType;
  }
  if (params.status !== "all" && params.status) {
    filter.reviewStatus = params.status;
  }
  if (params.teams.length) {
    filter.productionTeam = { $in: params.teams };
  }

  if (options.includePublishDate !== false && params.dateStart && params.dateEnd) {
    filter.publishDate = { $gte: params.dateStart, $lte: params.dateEnd };
  }

  const keyword = params.keyword.trim();
  if (keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = { $regex: escaped, $options: "i" };
    filter.$or = [
      { title: regex },
      { shopName: regex },
      { relatedProduct: regex },
      { productionTeam: regex },
    ];
  }

  return filter;
}

export function buildCreatorInsightsSearchParams(
  params: Pick<
    CreatorInsightsQueryParams,
    "shop" | "workType" | "creationType" | "status" | "teams" | "keyword" | "dateStart" | "dateEnd"
  > & { page?: number }
): URLSearchParams {
  const search = new URLSearchParams();
  if (params.shop !== "all") search.set("shop", params.shop);
  if (params.workType !== "all") search.set("workType", params.workType);
  if (params.creationType !== "all") search.set("creationType", params.creationType);
  if (params.status !== "all") search.set("status", params.status);
  if (params.teams.length) search.set("teams", params.teams.join(","));
  if (params.keyword.trim()) search.set("keyword", params.keyword.trim());
  if (params.dateStart) search.set("dateStart", params.dateStart);
  if (params.dateEnd) search.set("dateEnd", params.dateEnd);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  return search;
}
