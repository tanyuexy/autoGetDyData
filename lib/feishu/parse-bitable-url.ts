/**
 * 从飞书多维表格分享链接中解析 appToken 与 tableId。
 *
 * 支持的 URL 形如：
 *   https://<tenant>.feishu.cn/base/<appToken>?table=<tableId>&view=<viewId>
 *   https://<tenant>.larksuite.com/base/<appToken>?table=<tableId>&view=<viewId>
 *
 * 也兼容只传 path 片段（如 `/base/<appToken>?table=<tableId>`）的情况。
 */
export interface ParsedBitableUrl {
  appToken: string;
  tableId: string;
  viewId?: string;
}

const APP_TOKEN_RE = /\/base\/([A-Za-z0-9]+)/;
const TABLE_ID_RE = /[?&]table=([A-Za-z0-9]+)/;
const VIEW_ID_RE = /[?&]view=([A-Za-z0-9]+)/;

export function parseFeishuBitableUrl(raw: string): ParsedBitableUrl | null {
  const url = String(raw || "").trim();
  if (!url) return null;

  const appTokenMatch = url.match(APP_TOKEN_RE);
  const tableIdMatch = url.match(TABLE_ID_RE);
  if (!appTokenMatch || !tableIdMatch) return null;

  const viewIdMatch = url.match(VIEW_ID_RE);
  return {
    appToken: appTokenMatch[1],
    tableId: tableIdMatch[1],
    ...(viewIdMatch ? { viewId: viewIdMatch[1] } : {}),
  };
}

export function isValidFeishuBitableUrl(raw: string): boolean {
  return parseFeishuBitableUrl(raw) !== null;
}
