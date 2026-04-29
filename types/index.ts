export interface CreatorAccount {
  name: string;
  hasStorageState: boolean;
  hasCookies: boolean;
  hasExportDateConfig: boolean;
  exportDateStart: string | null;
}

export interface ShopAccount {
  email: string;
  password: string;
  hasStorageState: boolean;
}

export interface FeishuTokenStatus {
  valid: boolean;
  expiresAt: string | null;
  hasToken: boolean;
}

export interface ConfigData {
  accounts: string[];
  emails: { email: string; password: string }[];
  creatorExportDateStart: string | null;
  creatorExportDateStartByAccount: Record<string, string>;
  douyinCreator: { loginVerifyMethod: string };
  headless: boolean;
  feishu: {
    shop: { baseUrl?: string; appToken: string; tableId: string };
    creator: { baseUrl?: string; appToken: string; tableId: string };
    worksStripCopy: {
      appToken: string;
      sourceTableId: string;
      targetTableId: string;
      titleFieldName: string;
    };
  };
}

export interface LogEntry {
  text: string;
  level: "info" | "warn" | "error";
  timestamp: string;
}

export interface TaskProgress {
  current: number;
  total: number;
  label: string;
}

export interface SSEDoneEvent {
  code: number;
  summary: string;
}
