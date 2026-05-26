import { ACLType, TosClient } from "@volcengine/tos-sdk";
import { getTosConfig } from "./config";

let cachedClient: TosClient | null = null;
let cachedSignature = "";

function getTosClient(config: NonNullable<ReturnType<typeof getTosConfig>>) {
  const signature = `${config.accessKeyId}:${config.region}:${config.endpoint}`;
  if (cachedClient && cachedSignature === signature) {
    return cachedClient;
  }

  cachedClient = new TosClient({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    region: config.region,
    endpoint: config.endpoint,
  });
  cachedSignature = signature;
  return cachedClient;
}

export function buildTosObjectKey(uploadPrefix: string, filename: string) {
  const normalizedPrefix = uploadPrefix.replace(/^\/+|\/+$/g, "");
  return normalizedPrefix ? `${normalizedPrefix}/${filename}` : filename;
}

export function buildTosPublicUrl(publicBaseUrl: string, objectKey: string) {
  const encodedKey = objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${publicBaseUrl.replace(/\/+$/, "")}/${encodedKey}`;
}

export async function uploadBufferToTos(input: {
  body: Buffer;
  objectKey: string;
  contentType?: string;
}) {
  const config = getTosConfig();
  if (!config) {
    throw new Error("TOS 未配置。请设置 TOS_ACCESS_KEY、TOS_SECRET_KEY、TOS_BUCKET。");
  }

  const client = getTosClient(config);
  await client.putObject({
    bucket: config.bucket,
    key: input.objectKey,
    body: input.body,
    contentType: input.contentType,
    acl: ACLType.ACLPublicRead,
  });

  return {
    bucket: config.bucket,
    objectKey: input.objectKey,
    url: buildTosPublicUrl(config.publicBaseUrl, input.objectKey),
  };
}
