import { getAuthSecret, isAppAuthEnabled } from "@/lib/auth/config";

export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

type SessionPayload = {
  u: string;
  exp: number;
};

const textEncoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLen);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function signPayloadBase64(payloadB64: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payloadB64));
  return bytesToBase64Url(new Uint8Array(signature));
}

function encodePayload(payload: SessionPayload): string {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)));
}

function decodePayload(payloadB64: string): SessionPayload | null {
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(payloadB64));
    const payload = JSON.parse(json) as SessionPayload;
    if (!payload?.u || typeof payload.exp !== "number") return null;
    return payload;
  } catch {
    return null;
  }
}

/** Edge / Node 通用（Web Crypto），供 proxy 与 API 共用 */
export async function createSessionToken(username: string): Promise<string> {
  const secret = getAuthSecret();
  const payload: SessionPayload = {
    u: username.trim(),
    exp: Date.now() + SESSION_MAX_AGE_SEC * 1000,
  };
  const payloadB64 = encodePayload(payload);
  const sig = await signPayloadBase64(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export async function parseSessionToken(
  token: string | undefined | null
): Promise<{ username: string } | null> {
  if (!token || !isAppAuthEnabled()) return null;
  const secret = getAuthSecret();
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;

  const expected = await signPayloadBase64(payloadB64, secret);
  if (!timingSafeEqualString(sig, expected)) return null;

  const payload = decodePayload(payloadB64);
  if (!payload || payload.exp < Date.now()) return null;
  return { username: String(payload.u).trim() };
}
