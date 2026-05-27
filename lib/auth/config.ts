export interface AppAuthUser {
  username: string;
  password: string;
}

const COOKIE_NAME = 'app_session';

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

/** 未配置 APP_AUTH_USERS 时不启用登录（兼容旧部署） */
export function isAppAuthEnabled(): boolean {
  return getAppAuthUsers().length > 0;
}

export function getAuthSecret(): string {
  const secret = String(process.env.APP_AUTH_SECRET || '').trim();
  if (!secret && isAppAuthEnabled()) {
    throw new Error('已配置 APP_AUTH_USERS，请同时设置 APP_AUTH_SECRET');
  }
  return secret;
}

/**
 * 环境变量 APP_AUTH_USERS：JSON 数组，支持多账号与密码中的特殊字符。
 * 示例：[{"username":"admin","password":"a:b,c"},{"username":"zhangsan","password":"yyy"}]
 */
export function getAppAuthUsers(): AppAuthUser[] {
  const raw = String(process.env.APP_AUTH_USERS || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const users: AppAuthUser[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as { username?: string; password?: string };
      const username = String(row.username || "").trim();
      const password = String(row.password || "");
      if (!username || !password || seen.has(username)) continue;
      seen.add(username);
      users.push({ username, password });
    }
    return users;
  } catch {
    return [];
  }
}

export function verifyAppCredentials(username: string, password: string): boolean {
  const normalized = username.trim();
  if (!normalized || !password) return false;
  const users = getAppAuthUsers();
  const found = users.find((u) => u.username === normalized);
  if (!found) return false;
  return found.password === password;
}
