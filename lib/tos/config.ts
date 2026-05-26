export type TosConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  endpoint: string;
  bucket: string;
  uploadPrefix: string;
  outputPrefix: string;
  publicBaseUrl: string;
};

function trim(value: string | undefined) {
  return String(value || "").trim();
}

function normalizePrefix(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

export function getTosConfig(): TosConfig | null {
  const accessKeyId = trim(process.env.TOS_ACCESS_KEY || process.env.VOLCENGINE_ACCESS_KEY);
  const accessKeySecret = trim(process.env.TOS_SECRET_KEY || process.env.VOLCENGINE_SECRET_KEY);
  const bucket = trim(process.env.TOS_BUCKET);
  const region = trim(process.env.TOS_REGION) || "cn-beijing";

  if (!accessKeyId || !accessKeySecret || !bucket) {
    return null;
  }

  const endpoint = trim(process.env.TOS_ENDPOINT) || `tos-${region}.volces.com`;
  const uploadPrefix = normalizePrefix(trim(process.env.TOS_UPLOAD_PREFIX) || "seedance");
  const outputPrefix = normalizePrefix(trim(process.env.TOS_OUTPUT_PREFIX) || "output");
  const publicBaseUrl =
    trim(process.env.TOS_PUBLIC_BASE_URL).replace(/\/+$/, "") ||
    `https://${bucket}.${endpoint}`;

  return {
    accessKeyId,
    accessKeySecret,
    region,
    endpoint,
    bucket,
    uploadPrefix,
    outputPrefix,
    publicBaseUrl,
  };
}

export function isTosUploadEnabled() {
  return getTosConfig() !== null;
}
