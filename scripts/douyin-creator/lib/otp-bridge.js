function getOtpBridgeConfig() {
  const baseUrl = String(process.env.OTP_BRIDGE_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const accessToken = String(process.env.OTP_BRIDGE_ACCESS_TOKEN || "").trim();
  const timeoutMs = Math.max(
    1000,
    (Number.parseInt(process.env.OTP_BRIDGE_TIMEOUT_MS || "3600", 10) || 3600) * 1000
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

async function createOtpBridgeSession(
  { accountName, maskedPhone = "", reason = "" } = {},
  cfg = getOtpBridgeConfig()
) {
  if (!isOtpBridgeLinkEnabled(cfg)) {
    return {
      requestId: "",
      entryUrl: "",
      missingConfig: false,
      bridgeEnabled: false
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/api/session/create`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        accountName,
        maskedPhone,
        reason,
        token: cfg.accessToken || undefined
      })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => ({}));
    return {
      requestId: String(data?.requestId || ""),
      entryUrl: String(data?.entryUrl || ""),
      expiresAt: Number(data?.expiresAt || 0),
      ttlMs: Number(data?.ttlMs || 0),
      missingConfig: false,
      bridgeEnabled: true
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOtpCodeFromBridge(
  { requestId },
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
  if (!requestId) {
    return {
      otpCode: "",
      checkedCount: 0,
      matchedSubjectCount: 0,
      missingConfig: false,
      bridgeEnabled: true,
      missingRequestId: true,
      source: ""
    };
  }

  const url = new URL(`${cfg.baseUrl}/api/latest`);
  url.searchParams.set("requestId", String(requestId));
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
      missingRequestId: false,
      requestId: String(data?.requestId || requestId),
      source: data?.source ? String(data.source) : ""
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  getOtpBridgeConfig,
  isOtpBridgeLinkEnabled,
  createOtpBridgeSession,
  fetchOtpCodeFromBridge
};
