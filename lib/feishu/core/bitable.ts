// @ts-nocheck
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

function resolveTableId(config, tableId) {
  const resolved = String(tableId || config.bitableTableId || "").trim();
  if (!resolved) {
    throw new Error("缺少 FEISHU_BITABLE_TABLE_ID");
  }
  return resolved;
}

async function listBitableFields(config, accessToken, tableId = "") {
  if (!config.bitableAppToken) {
    throw new Error("缺少 FEISHU_BITABLE_APP_TOKEN");
  }
  const resolvedTableId = resolveTableId(config, tableId);

  const allItems = [];
  let pageToken = "";

  while (true) {
    const params = new URLSearchParams({
      page_size: "500"
    });
    if (pageToken) {
      params.set("page_token", pageToken);
    }

    const url = `${config.apiBase}/open-apis/bitable/v1/apps/${encodeURIComponent(
      config.bitableAppToken
    )}/tables/${encodeURIComponent(resolvedTableId)}/fields?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (error) {
      throw new Error(`多维表格字段接口返回非 JSON: ${text || "<empty>"}`);
    }

    if (!response.ok) {
      throw new Error(
        `多维表格字段接口 HTTP ${response.status}: ${parsed.msg || text || "未知错误"}`
      );
    }
    if (typeof parsed.code === "number" && parsed.code !== 0) {
      throw new Error(
        `获取字段失败 code=${parsed.code}, msg=${parsed.msg || "未知错误"}`
      );
    }

    const data = parsed.data || {};
    const items = Array.isArray(data.items) ? data.items : [];
    allItems.push(...items);

    if (!data.has_more) break;
    pageToken = String(data.page_token || "");
    if (!pageToken) break;
  }

  return allItems;
}

async function listAllBitableRecords(config, accessToken, tableId = "", fieldNames = []) {
  if (!config.bitableAppToken) {
    throw new Error("缺少 FEISHU_BITABLE_APP_TOKEN");
  }
  const resolvedTableId = resolveTableId(config, tableId);
  const records = [];
  let pageToken = "";

  while (true) {
    const params = new URLSearchParams({
      page_size: "500"
    });
    if (Array.isArray(fieldNames) && fieldNames.length) {
      params.set("field_names", JSON.stringify(fieldNames));
    }
    if (pageToken) {
      params.set("page_token", pageToken);
    }

    const url = `${config.apiBase}/open-apis/bitable/v1/apps/${encodeURIComponent(
      config.bitableAppToken
    )}/tables/${encodeURIComponent(resolvedTableId)}/records?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (error) {
      throw new Error(`多维表格列出记录接口返回非 JSON: ${text || "<empty>"}`);
    }

    if (!response.ok) {
      throw new Error(
        `多维表格列出记录接口 HTTP ${response.status}: ${parsed.msg || text || "未知错误"}`
      );
    }
    if (typeof parsed.code === "number" && parsed.code !== 0) {
      throw new Error(
        `列出记录失败 code=${parsed.code}, msg=${parsed.msg || "未知错误"}`
      );
    }

    const data = parsed.data || {};
    const items = Array.isArray(data.items) ? data.items : [];
    records.push(...items);

    if (!data.has_more) break;
    pageToken = String(data.page_token || "");
    if (!pageToken) break;
  }

  return records;
}

async function listAllBitableRecordIds(config, accessToken, tableId = "") {
  const records = await listAllBitableRecords(config, accessToken, tableId);
  const ids = [];
  for (const item of records) {
    const id = item && item.record_id;
    if (id) {
      ids.push(String(id));
    }
  }
  return ids;
}

function resolveBitableTableIdForMutation(config, tableIdOverride = "") {
  const resolved = String(
    (tableIdOverride && String(tableIdOverride).trim()) ||
      config.bitableTableId ||
      ""
  ).trim();
  if (!resolved) {
    throw new Error("缺少 FEISHU_BITABLE_TABLE_ID 或显式 tableId");
  }
  return resolved;
}

async function batchDeleteBitableRecords(
  config,
  accessToken,
  recordIds,
  tableIdOverride = ""
) {
  if (!config.bitableAppToken) {
    throw new Error("缺少 FEISHU_BITABLE_APP_TOKEN");
  }
  if (!Array.isArray(recordIds) || !recordIds.length) {
    return { deleted: 0 };
  }
  if (recordIds.length > 500) {
    throw new Error("batchDeleteBitableRecords 单次最多 500 条，请在上层分批");
  }

  const resolvedTableId = resolveBitableTableIdForMutation(
    config,
    tableIdOverride
  );

  const url = `${config.apiBase}/open-apis/bitable/v1/apps/${encodeURIComponent(
    config.bitableAppToken
  )}/tables/${encodeURIComponent(resolvedTableId)}/records/batch_delete`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ records: recordIds })
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`多维表格批量删除接口返回非 JSON: ${text || "<empty>"}`);
  }

  if (!response.ok) {
    throw new Error(
      `多维表格批量删除接口 HTTP ${response.status}: ${parsed.msg || text || "未知错误"}`
    );
  }
  if (typeof parsed.code === "number" && parsed.code !== 0) {
    throw new Error(
      `批量删除失败 code=${parsed.code}, msg=${parsed.msg || "未知错误"}`
    );
  }

  return parsed.data || parsed;
}

async function batchCreateBitableRecords(
  config,
  accessToken,
  recordsPayload,
  tableIdOverride = ""
) {
  if (!config.bitableAppToken) {
    throw new Error("缺少 FEISHU_BITABLE_APP_TOKEN");
  }
  if (!Array.isArray(recordsPayload) || !recordsPayload.length) {
    return { created: 0 };
  }
  if (recordsPayload.length > 1000) {
    throw new Error("batchCreateBitableRecords 单次最多 1000 条，请在上层分批");
  }

  const resolvedTableId = resolveBitableTableIdForMutation(
    config,
    tableIdOverride
  );

  const url = `${config.apiBase}/open-apis/bitable/v1/apps/${encodeURIComponent(
    config.bitableAppToken
  )}/tables/${encodeURIComponent(resolvedTableId)}/records/batch_create`;

  const body = {
    records: recordsPayload.map((item) => {
      if (item && item.fields && typeof item.fields === "object") {
        return { fields: item.fields };
      }
      return { fields: item };
    })
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`多维表格批量新增接口返回非 JSON: ${text || "<empty>"}`);
  }

  if (!response.ok) {
    throw new Error(
      `多维表格批量新增接口 HTTP ${response.status}: ${parsed.msg || text || "未知错误"}`
    );
  }
  if (typeof parsed.code === "number" && parsed.code !== 0) {
    throw new Error(
      `批量新增失败 code=${parsed.code}, msg=${parsed.msg || "未知错误"}`
    );
  }

  const data = parsed.data || {};
  const items = Array.isArray(data.records) ? data.records : [];
  return { records: items };
}

async function updateBitableRecord(config, accessToken, recordId, fields, tableIdOverride = "") {
  if (!config.bitableAppToken) {
    throw new Error("缺少 FEISHU_BITABLE_APP_TOKEN");
  }
  if (!recordId) throw new Error("缺少 recordId");
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("fields 必须是对象");
  }

  const resolvedTableId = resolveBitableTableIdForMutation(config, tableIdOverride);

  const url = `${config.apiBase}/open-apis/bitable/v1/apps/${encodeURIComponent(
    config.bitableAppToken
  )}/tables/${encodeURIComponent(resolvedTableId)}/records/${encodeURIComponent(recordId)}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ fields }),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`多维表格更新接口返回非 JSON: ${text || "<empty>"}`);
  }

  if (!response.ok) {
    throw new Error(
      `多维表格更新接口 HTTP ${response.status}: ${parsed.msg || text || "未知错误"}`
    );
  }
  if (typeof parsed.code === "number" && parsed.code !== 0) {
    throw new Error(
      `更新记录失败 code=${parsed.code}, msg=${parsed.msg || "未知错误"}`
    );
  }

  return parsed.data || parsed;
}

const fs = require("fs");
const path = require("path");

async function downloadAttachment(config, accessToken, fileToken, saveDir, fileName) {
  if (!fileToken) throw new Error("缺少 fileToken");

  const url = `${config.apiBase}/open-apis/drive/v1/medias/${encodeURIComponent(
    fileToken
  )}/download`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `下载附件失败 HTTP ${response.status}: ${text || "未知错误"}`
    );
  }

  // 从 Content-Disposition 获取文件名（如果有）
  let finalName = fileName;
  if (!finalName) {
    const disposition = response.headers.get("content-disposition");
    if (disposition) {
      const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match) {
        finalName = match[1].replace(/['"]/g, "");
      }
    }
  }
  if (!finalName) finalName = fileToken;

  if (saveDir && !fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }

  const savePath = saveDir ? path.join(saveDir, finalName) : finalName;
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(savePath, buffer);

  return { filePath: savePath, fileName: finalName, size: buffer.length };
}

async function batchUpdateBitableRecords(
  config,
  accessToken,
  recordsPayload,
  tableIdOverride = ""
) {
  if (!config.bitableAppToken) {
    throw new Error("缺少 FEISHU_BITABLE_APP_TOKEN");
  }
  if (!Array.isArray(recordsPayload) || !recordsPayload.length) {
    return { updated: 0 };
  }
  if (recordsPayload.length > 500) {
    throw new Error("batchUpdateBitableRecords 单次最多 500 条，请在上层分批");
  }

  const resolvedTableId = resolveBitableTableIdForMutation(
    config,
    tableIdOverride
  );

  const url = `${config.apiBase}/open-apis/bitable/v1/apps/${encodeURIComponent(
    config.bitableAppToken
  )}/tables/${encodeURIComponent(resolvedTableId)}/records/batch_update`;

  const body = {
    records: recordsPayload.map((item) => ({
      record_id: item.record_id,
      fields: item.fields,
    })),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`多维表格批量更新接口返回非 JSON: ${text || "<empty>"}`);
  }

  if (!response.ok) {
    throw new Error(
      `多维表格批量更新接口 HTTP ${response.status}: ${parsed.msg || text || "未知错误"}`
    );
  }
  if (typeof parsed.code === "number" && parsed.code !== 0) {
    throw new Error(
      `批量更新失败 code=${parsed.code}, msg=${parsed.msg || "未知错误"}`
    );
  }

  const data = parsed.data || {};
  const items = Array.isArray(data.records) ? data.records : [];
  return { records: items, updated: items.length };
}

module.exports = {
  createBitableRecord,
  updateBitableRecord,
  batchUpdateBitableRecords,
  listBitableFields,
  listAllBitableRecords,
  listAllBitableRecordIds,
  batchDeleteBitableRecords,
  batchCreateBitableRecords,
  downloadAttachment,
};
