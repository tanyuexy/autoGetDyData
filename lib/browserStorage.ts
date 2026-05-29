/** 浏览器 localStorage 读写封装（SSR 安全、吞掉 quota / 隐私模式异常） */

export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function readLocalStorageRaw(key: string): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readLocalStorageString(key: string): string | null {
  return readLocalStorageRaw(key);
}

export function writeLocalStorageRaw(key: string, value: string): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readLocalStorageJson<T>(key: string, fallback: T): T {
  const raw = readLocalStorageRaw(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function readLocalStorageJsonNullable<T>(key: string): T | null {
  const raw = readLocalStorageRaw(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeLocalStorageJson(key: string, value: unknown): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeLocalStorageItem(key: string): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
