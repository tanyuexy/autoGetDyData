const fs = require("fs");
const path = require("path");

/**
 * Cookie 过期状态
 *  - valid:   文件存在，所有关键 cookie 未过期
 *  - warning: 文件存在，但部分 cookie 已过期 或 文件较旧（可能过期）
 *  - expired: 文件存在，但所有关键 cookie 都已过期
 *  - missing: 文件不存在
 */
const COOKIE_STATUS = { VALID: "valid", WARNING: "warning", EXPIRED: "expired", MISSING: "missing" };

/**
 * 针对抖店的关键 cookie 名称模式
 */
const SHOP_KEY_COOKIE_PATTERNS = [
  { domain: "jinritemai.com" },
  { name: /^sid_/ },
  { name: /session/ },
  { name: /sso/ },
  { name: /passport/ },
  { name: /login/ },
  { name: /_token/ },
  { name: /csrf/i },
];

/**
 * 针对抖创的关键 cookie 模式
 */
const CREATOR_KEY_COOKIE_PATTERNS = [
  { domain: "douyin.com" },
  { name: /^sid_/ },
  { name: /session/ },
  { name: /sso/ },
  { name: /passport/ },
  { name: /login/ },
  { name: /_token/ },
  { name: /csrf/i },
];

function isKeyCookie(cookie, patterns) {
  return patterns.some((p) => {
    if (p.domain && cookie.domain && cookie.domain.includes(p.domain)) return true;
    if (p.name && p.name.test(cookie.name)) return true;
    return false;
  });
}

function cookieExpired(cookie) {
  if (cookie.expires == null || cookie.expires === -1) return false;
  const now = Date.now() / 1000;
  return cookie.expires < now;
}

/**
 * 分析 storageState.json 中的 cookie 状态
 */
function analyzeStorageState(storagePath, keyPatterns, maxAgeDays = 30) {
  let fileStat;
  try {
    fileStat = fs.statSync(storagePath);
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

  let cookies = [];
  try {
    const raw = fs.readFileSync(storagePath, "utf-8");
    const data = JSON.parse(raw);
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
    const expiredAll = cookies.filter((c) => cookieExpired(c)).length;
    const totalExpired = cookies.filter((c) => c.expires !== -1 && cookieExpired(c)).length;
    const totalDated = cookies.filter((c) => c.expires !== -1).length;

    if (totalDated === 0) {
      return {
        status: fileAgeDays > maxAgeDays ? COOKIE_STATUS.WARNING : COOKIE_STATUS.VALID,
        detail: fileAgeDays > maxAgeDays
          ? `文件超过 ${maxAgeDays} 天未更新（${Math.round(fileAgeDays)}天），可能已过期`
          : "所有 cookie 均为会话 cookie，未检测到过期",
        lastLoginAt,
        totalCookies,
        keyCookies: 0,
        expiredCount: 0,
      };
    }

    if (expiredAll > 0) {
      return {
        status: expiredAll === totalDated ? COOKIE_STATUS.EXPIRED : COOKIE_STATUS.WARNING,
        detail: `${expiredAll}/${totalDated} 个带过期时间的 cookie 已过期`,
        lastLoginAt,
        totalCookies,
        keyCookies: 0,
        expiredCount: expiredAll,
      };
    }

    return {
      status: fileAgeDays > maxAgeDays ? COOKIE_STATUS.WARNING : COOKIE_STATUS.VALID,
      detail: fileAgeDays > maxAgeDays
        ? `文件超过 ${maxAgeDays} 天未更新（${Math.round(fileAgeDays)}天）`
        : "cookie 未过期",
      lastLoginAt,
      totalCookies,
      keyCookies: 0,
      expiredCount: 0,
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

/**
 * 读取最近一次浏览器验证结果，用于覆盖 cookie 静态分析
 * @param {string} accountDir - 账号目录路径
 * @returns {{ verifiedAt: string|null, detail: string|null }}
 */
function readLastVerified(accountDir) {
  const vp = path.join(accountDir, "verified-at.json");
  try {
    const raw = fs.readFileSync(vp, "utf-8");
    const data = JSON.parse(raw);
    if (!data || typeof data.time !== "number") return { verifiedAt: null, detail: null };
    const ageH = (Date.now() - data.time) / (3600 * 1000);
    if (ageH > 24) return { verifiedAt: null, detail: null };
    return {
      verifiedAt: new Date(data.time).toISOString(),
      detail: data.detail || `浏览器验证通过 (${Math.round(ageH)}h 前)`,
    };
  } catch {
    return { verifiedAt: null, detail: null };
  }
}

module.exports = {
  COOKIE_STATUS,
  SHOP_KEY_COOKIE_PATTERNS,
  CREATOR_KEY_COOKIE_PATTERNS,
  analyzeStorageState,
  readLastVerified,
};
