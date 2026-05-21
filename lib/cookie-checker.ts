import path from "path";
import fse from "fs-extra";

/** Cookie UI 语义：与表格「登录态」列一致 */
export type CookieUiStatus = "valid" | "warning" | "expired" | "missing";

export interface KeyPattern {
  domain?: string;
  name?: RegExp;
}

interface StorageCookie {
  name: string;
  domain?: string;
  expires?: number | null;
}

export interface StorageStateAnalysisResult {
  status: CookieUiStatus;
  detail: string;
  lastLoginAt: string | null;
  totalCookies: number;
  keyCookies: number;
  expiredCount: number;
}

/** `readLastVerified` 返回值 */
export interface VerifiedSnapshot {
  verifiedAt: string | null;
  detail: string | null;
  status: "valid" | "expired" | null;
}

export const COOKIE_STATUS = {
  VALID: "valid",
  WARNING: "warning",
  EXPIRED: "expired",
  MISSING: "missing",
} as const satisfies Record<string, CookieUiStatus>;

export const SHOP_KEY_COOKIE_PATTERNS: KeyPattern[] = [
  { domain: "jinritemai.com" },
  { name: /^sid_/ },
  { name: /session/ },
  { name: /sso/ },
  { name: /passport/ },
  { name: /login/ },
  { name: /_token/ },
  { name: /csrf/i },
];

export const CREATOR_KEY_COOKIE_PATTERNS: KeyPattern[] = [
  { domain: "douyin.com" },
  { name: /^sid_/ },
  { name: /session/ },
  { name: /sso/ },
  { name: /passport/ },
  { name: /login/ },
  { name: /_token/ },
  { name: /csrf/i },
];

function isKeyCookie(cookie: StorageCookie, patterns: KeyPattern[]): boolean {
  return patterns.some((p) => {
    if (p.domain && cookie.domain && cookie.domain.includes(p.domain)) return true;
    if (p.name && p.name.test(cookie.name)) return true;
    return false;
  });
}

function cookieExpired(cookie: StorageCookie): boolean {
  if (cookie.expires == null || cookie.expires === -1) return false;
  const now = Date.now() / 1000;
  return cookie.expires < now;
}

function analyzeWhenNoKeyCookies(params: {
  cookies: StorageCookie[];
  maxAgeDays: number;
  fileAgeDays: number;
  lastLoginAt: string;
}): Omit<StorageStateAnalysisResult, "keyCookies"> {
  const { cookies, maxAgeDays, fileAgeDays, lastLoginAt } = params;

  const totalCookies = cookies.length;
  const expiredAll = cookies.filter((c) => cookieExpired(c)).length;
  const totalDated = cookies.filter((c) => c.expires !== -1).length;

  if (totalDated === 0) {
    return {
      status: fileAgeDays > maxAgeDays ? COOKIE_STATUS.WARNING : COOKIE_STATUS.VALID,
      detail:
        fileAgeDays > maxAgeDays
          ? `文件超过 ${maxAgeDays} 天未更新（${Math.round(fileAgeDays)}天），可能已过期`
          : "所有 cookie 均为会话 cookie，未检测到过期",
      lastLoginAt,
      totalCookies,
      expiredCount: 0,
    };
  }

  if (expiredAll > 0) {
    return {
      status: expiredAll === totalDated ? COOKIE_STATUS.EXPIRED : COOKIE_STATUS.WARNING,
      detail: `${expiredAll}/${totalDated} 个带过期时间的 cookie 已过期`,
      lastLoginAt,
      totalCookies,
      expiredCount: expiredAll,
    };
  }

  return {
    status: fileAgeDays > maxAgeDays ? COOKIE_STATUS.WARNING : COOKIE_STATUS.VALID,
    detail:
      fileAgeDays > maxAgeDays
        ? `文件超过 ${maxAgeDays} 天未更新（${Math.round(fileAgeDays)}天）`
        : "cookie 未过期",
    lastLoginAt,
    totalCookies,
    expiredCount: 0,
  };
}

/**
 * 分析 storageState.json 中的 cookie 状态（不涉及浏览器）
 */
export function analyzeStorageState(
  storagePath: string,
  keyPatterns: KeyPattern[],
  maxAgeDays = 30
): StorageStateAnalysisResult {
  let fileStat;
  try {
    fileStat = fse.statSync(storagePath);
  } catch {
    return {
      status: COOKIE_STATUS.MISSING,
      detail: "文件不存在",
      lastLoginAt: null,
      totalCookies: 0,
      keyCookies: 0,
      expiredCount: 0,
    };
  }

  const lastLoginAt = fileStat.mtime.toISOString();
  const fileAgeDays = (Date.now() - fileStat.mtimeMs) / (24 * 3600 * 1000);

  let cookies: StorageCookie[];
  try {
    const raw = fse.readFileSync(storagePath, "utf-8");
    const data = JSON.parse(raw) as { cookies?: StorageCookie[] };
    cookies = Array.isArray(data.cookies) ? data.cookies : [];
  } catch {
    return {
      status: COOKIE_STATUS.EXPIRED,
      detail: "文件损坏无法解析",
      lastLoginAt,
      totalCookies: 0,
      keyCookies: 0,
      expiredCount: 0,
    };
  }

  if (cookies.length === 0) {
    return {
      status: COOKIE_STATUS.EXPIRED,
      detail: "无 cookie 记录",
      lastLoginAt,
      totalCookies: 0,
      keyCookies: 0,
      expiredCount: 0,
    };
  }

  const keyCookies = cookies.filter((c) => isKeyCookie(c, keyPatterns));
  const totalCookies = cookies.length;
  const keyCookiesCount = keyCookies.length;

  if (keyCookiesCount === 0) {
    const inner = analyzeWhenNoKeyCookies({ cookies, maxAgeDays, fileAgeDays, lastLoginAt });
    return {
      ...inner,
      keyCookies: 0,
    };
  }

  const expiredKeyCookies = keyCookies.filter((c) => cookieExpired(c));
  const expiredCount = expiredKeyCookies.length;

  if (expiredCount > 0) {
    const allKeyExpired = expiredCount >= keyCookiesCount;
    return {
      status: allKeyExpired ? COOKIE_STATUS.EXPIRED : COOKIE_STATUS.WARNING,
      detail: `${expiredCount}/${keyCookiesCount} 个关键 cookie 已过期`,
      lastLoginAt,
      totalCookies,
      keyCookies: keyCookiesCount,
      expiredCount,
    };
  }

  if (fileAgeDays > maxAgeDays) {
    return {
      status: COOKIE_STATUS.WARNING,
      detail: `文件超过 ${maxAgeDays} 天未更新（${Math.round(fileAgeDays)}天），可能已过期`,
      lastLoginAt,
      totalCookies,
      keyCookies: keyCookiesCount,
      expiredCount: 0,
    };
  }

  return {
    status: COOKIE_STATUS.VALID,
    detail: "登录态有效",
    lastLoginAt,
    totalCookies,
    keyCookies: keyCookiesCount,
    expiredCount: 0,
  };
}

/** 最近一次浏览器验证快照（verified-at.json，24h 内有效） */
export function readLastVerified(accountDir: string): VerifiedSnapshot {
  const vp = path.join(accountDir, "verified-at.json");
  try {
    const raw = fse.readFileSync(vp, "utf-8");
    const data = JSON.parse(raw) as {
      time?: number;
      verified?: boolean;
      status?: string;
      detail?: string;
    };
    if (!data || typeof data.time !== "number") {
      return { verifiedAt: null, detail: null, status: null };
    }
    const ageH = (Date.now() - data.time) / (3600 * 1000);
    if (ageH > 24) return { verifiedAt: null, detail: null, status: null };
    const status: "valid" | "expired" | null =
      data.status === COOKIE_STATUS.VALID || data.status === COOKIE_STATUS.EXPIRED
        ? data.status
        : data.verified === true
          ? COOKIE_STATUS.VALID
          : data.verified === false
            ? COOKIE_STATUS.EXPIRED
            : null;
    return {
      verifiedAt: new Date(data.time).toISOString(),
      detail: data.detail || `浏览器验证通过 (${Math.round(ageH)}h 前)`,
      status,
    };
  } catch {
    return { verifiedAt: null, detail: null, status: null };
  }
}

/**
 * 静态分析结果 + 24h 内浏览器验证：仅当验证时间不早于 storage 文件 mtime（lastLoginAt）时覆盖表格状态。
 */
export function mergeVerificationIntoAnalysis(
  analysis: StorageStateAnalysisResult,
  lastVerified: VerifiedSnapshot
): { cookieStatus: CookieUiStatus; cookieDetail: string | null } {
  const hasStorage = analysis.status !== "missing";

  let cookieStatus: CookieUiStatus = hasStorage ? analysis.status : COOKIE_STATUS.MISSING;
  let cookieDetail: string | null = hasStorage ? analysis.detail : null;

  const verifiedAtMs = lastVerified.verifiedAt
    ? new Date(lastVerified.verifiedAt).getTime()
    : 0;
  const lastLoginAtMs = analysis.lastLoginAt ? new Date(analysis.lastLoginAt).getTime() : 0;
  const shouldUseVerifiedResult =
    Boolean(lastVerified.verifiedAt && lastVerified.status) && verifiedAtMs >= lastLoginAtMs;

  if (shouldUseVerifiedResult && lastVerified.status) {
    cookieStatus = lastVerified.status;
    cookieDetail = lastVerified.detail || analysis.detail;
  }

  return { cookieStatus, cookieDetail };
}
