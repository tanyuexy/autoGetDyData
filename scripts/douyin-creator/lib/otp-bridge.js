function getOtpBridgeConfig() {
  const baseUrl = String(process.env.OTP_BRIDGE_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const accessToken = String(process.env.OTP_BRIDGE_ACCESS_TOKEN || "").trim();
  const timeoutMs = Math.max(
    1000,
    Number.parseInt(process.env.OTP_BRIDGE_TIMEOUT_MS || "5000", 10) || 5000
  );
  return {
    baseUrl,
    accessToken,
    timeoutMs
  };
}

function isOtpBridgeLinkEnabled(cfg = getOtpBridgeConfig()) {
  return Boolean(cfg.baseUrl);
}

function buildOtpBridgeEntryUrl(
  { accountName, maskedPhone = "", reason = "" } = {},
  cfg = getOtpBridgeConfig()
) {
  if (!isOtpBridgeLinkEnabled(cfg)) return "";
  let url;
  try {
    url = new URL(`${cfg.baseUrl}/`);
  } catch {
    return "";
  }
  if (accountName) url.searchParams.set("accountName", String(accountName));
  if (maskedPhone) url.searchParams.set("maskedPhone", String(maskedPhone));
  if (reason) url.searchParams.set("reason", String(reason));
  if (cfg.accessToken) {
    url.searchParams.set("token", cfg.accessToken);
  }
  return url.toString();
}

async function fetchOtpCodeFromBridge(
  { accountName, sinceMs },
  cfg = getOtpBridgeConfig()
) {
  if (!isOtpBridgeLinkEnabled(cfg)) {
    return {
      otpCode: "",
      checkedCount: 0,
      matchedSubjectCount: 0,
      missingConfig: false,
      bridgeEnabled: false,
      source: ""
    };
  }

  const url = new URL(`${cfg.baseUrl}/api/latest`);
  if (accountName) url.searchParams.set("accountName", String(accountName));
  if (Number.isFinite(sinceMs) && sinceMs > 0) {
    url.searchParams.set("sinceMs", String(sinceMs));
  }
  if (cfg.accessToken) {
    url.searchParams.set("token", cfg.accessToken);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => ({}));
    return {
      otpCode: String(data?.otpCode || ""),
      checkedCount: Number(data?.checkedCount || 0),
      matchedSubjectCount: Number(data?.matchedSubjectCount || 0),
      missingConfig: false,
      bridgeEnabled: true,
      source: data?.source ? String(data.source) : ""
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  getOtpBridgeConfig,
  isOtpBridgeLinkEnabled,
  buildOtpBridgeEntryUrl,
  fetchOtpCodeFromBridge
};
