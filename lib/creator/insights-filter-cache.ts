import {
  readLocalStorageJsonNullable,
  writeLocalStorageJson,
} from "@/lib/browserStorage";

export const CREATOR_INSIGHTS_FILTER_CACHE_KEY = "creator:insightsFilters";

export type CreatorInsightsDatePreset =
  | "all"
  | "today"
  | "tomorrow"
  | "yesterday"
  | "last7"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "custom";

const DATE_PRESETS = new Set<string>([
  "all",
  "today",
  "tomorrow",
  "yesterday",
  "last7",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
  "custom",
]);

export type CreatorInsightsFiltersCache = {
  shopFilter: string;
  typeFilter: string;
  statusFilter: string;
  productionTeamFilter: string[];
  keyword: string;
  datePreset: CreatorInsightsDatePreset;
  customDateStart: string | null;
  customDateEnd: string | null;
};

function isDatePreset(value: unknown): value is CreatorInsightsDatePreset {
  return typeof value === "string" && DATE_PRESETS.has(value);
}

export function readCreatorInsightsFiltersCache(): CreatorInsightsFiltersCache | null {
  const parsed = readLocalStorageJsonNullable<Partial<CreatorInsightsFiltersCache>>(
    CREATOR_INSIGHTS_FILTER_CACHE_KEY
  );
  if (!parsed || typeof parsed !== "object") return null;

  return {
    shopFilter: typeof parsed.shopFilter === "string" ? parsed.shopFilter : "all",
    typeFilter: typeof parsed.typeFilter === "string" ? parsed.typeFilter : "all",
    statusFilter: typeof parsed.statusFilter === "string" ? parsed.statusFilter : "all",
    productionTeamFilter: Array.isArray(parsed.productionTeamFilter)
      ? parsed.productionTeamFilter.map((value) => String(value)).filter(Boolean)
      : [],
    keyword: typeof parsed.keyword === "string" ? parsed.keyword : "",
    datePreset: isDatePreset(parsed.datePreset) ? parsed.datePreset : "thisMonth",
    customDateStart: typeof parsed.customDateStart === "string" ? parsed.customDateStart : null,
    customDateEnd: typeof parsed.customDateEnd === "string" ? parsed.customDateEnd : null,
  };
}

export function writeCreatorInsightsFiltersCache(snapshot: CreatorInsightsFiltersCache): void {
  writeLocalStorageJson(CREATOR_INSIGHTS_FILTER_CACHE_KEY, snapshot);
}
