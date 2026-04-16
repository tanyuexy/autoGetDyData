async function createBitableRecord(config, accessToken, fields) {
  if (!config.bitableAppToken) {
    throw new Error("缺少 FEISHU_BITABLE_APP_TOKEN");
  }
  if (!config.bitableTableId) {
    throw new Error("缺少 FEISHU_BITABLE_TABLE_ID");
  }
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("fields 必须是对象，例如: {\"姓名\":\"张三\"}");
  }

  const url = `${config.apiBase}/open-apis/bitable/v1/apps/${encodeURIComponent(
    config.bitableAppToken
  )}/tables/${encodeURIComponent(config.bitableTableId)}/records`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ fields })
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`多维表格接口返回非 JSON: ${text || "<empty>"}`);
  }

  if (!response.ok) {
    throw new Error(
      `多维表格接口 HTTP ${response.status}: ${parsed.msg || text || "未知错误"}`
    );
  }
  if (typeof parsed.code === "number" && parsed.code !== 0) {
    throw new Error(
      `多维表格插入失败 code=${parsed.code}, msg=${parsed.msg || "未知错误"}`
    );
  }
  return parsed.data || parsed;
}

module.exports = {
  createBitableRecord
};
