export function resolveMediaUrl(url?: string | null) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/") && typeof window !== "undefined") {
    return `${window.location.origin}${url}`;
  }
  return url;
}

export function isLocalMediaUrl(url: string) {
  const resolved = resolveMediaUrl(url);
  if (!resolved || resolved.startsWith("data:")) return Boolean(resolved);
  if (resolved.startsWith("/")) return true;
  if (typeof window === "undefined") return false;
  try {
    return new URL(resolved).origin === window.location.origin;
  } catch {
    return false;
  }
}
