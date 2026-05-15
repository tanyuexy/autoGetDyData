const fs = require("fs");
const crypto = require("crypto");

function splitAndTrimCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupe(list) {
  return Array.from(new Set((list || []).map((item) => String(item || "").trim()).filter(Boolean)));
}

function getWeComConfig(overrides = {}) {
  const webhookUrl = String(process.env.WECOM_WEBHOOK_URL || "").trim();
  const enabledRaw = process.env.WECOM_NOTIFY_ENABLED;
  const enabled =
    enabledRaw == null
      ? Boolean(webhookUrl)
      : String(enabledRaw).toLowerCase() !== "false";
  const mentionUsers = dedupe([
    ...splitAndTrimCsv(process.env.WECOM_MENTION_USERS || ""),
    ...(Array.isArray(overrides.mentionUsers) ? overrides.mentionUsers : [])
  ]);
  const mentionMobiles = dedupe([
    ...splitAndTrimCsv(process.env.WECOM_MENTION_MOBILES || ""),
    ...(Array.isArray(overrides.mentionMobiles) ? overrides.mentionMobiles : [])
  ]);

  return { enabled, webhookUrl, mentionUsers, mentionMobiles };
}

function isWeComEnabled(cfg = getWeComConfig()) {
  return Boolean(cfg.enabled && cfg.webhookUrl);
}

async function postWeComMessage(payload, overrides = {}) {
  const cfg = getWeComConfig(overrides);
  if (!isWeComEnabled(cfg)) {
    return false;
  }

  const res = await fetch(cfg.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errcode !== 0) {
    throw new Error(
      `企业微信推送失败: HTTP ${res.status}, ${data.errmsg || "unknown error"}`
    );
  }
  return true;
}

function buildMentionText(cfg = getWeComConfig()) {
  const parts = [];
  if (cfg.mentionUsers.length > 0) {
    parts.push(...cfg.mentionUsers.map((user) => `<@${user}>`));
  }
  if (cfg.mentionMobiles.length > 0) {
    // webhook 的 markdown 不支持手机号 @，这里明文展示，真正 @ 手机号可用 text 消息。
    parts.push(`提醒手机号: ${cfg.mentionMobiles.join(", ")}`);
  }
  return parts.length ? `\n\n${parts.join(" ")}` : "";
}

async function sendWeComMarkdown(content, overrides = {}) {
  const cfg = getWeComConfig(overrides);
  const text = `${String(content || "").trim()}${buildMentionText(cfg)}`.slice(0, 4096);
  if (!text) return false;
  return postWeComMessage({
    msgtype: "markdown",
    markdown: { content: text },
  }, overrides);
}

async function sendWeComText(content, overrides = {}) {
  const cfg = getWeComConfig(overrides);
  const text = String(content || "").trim().slice(0, 2048);
  if (!text) return false;
  return postWeComMessage({
    msgtype: "text",
    text: {
      content: text,
      mentioned_list: cfg.mentionUsers,
      mentioned_mobile_list: cfg.mentionMobiles,
    },
  }, overrides);
}

async function sendWeComImageFromFile(filePath, overrides = {}) {
  if (!filePath) return false;
  const buffer = await fs.promises.readFile(filePath);
  return postWeComMessage({
    msgtype: "image",
    image: {
      base64: buffer.toString("base64"),
      md5: crypto.createHash("md5").update(buffer).digest("hex"),
    },
  }, overrides);
}

module.exports = {
  getWeComConfig,
  isWeComEnabled,
  sendWeComMarkdown,
  sendWeComText,
  sendWeComImageFromFile,
};
