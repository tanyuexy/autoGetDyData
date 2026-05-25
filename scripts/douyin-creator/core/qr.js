const path = require("path");
const crypto = require("crypto");
const fse = require("fs-extra");
const { BROWSER_VIEWPORT } = require("./env");
const {
  loginQrFirstSeenAtByAccount,
  lastPushedLoginQrFingerprintByAccount
} = require("./state");

const qrDataUrlStateByPage = new WeakMap();
const NETWORK_QR_MAX_AGE_MS = 18 * 1000;
const DOM_QR_MAX_AGE_MS = 18 * 1000;
const NETWORK_QR_CAPTURE_WAIT_MS = 12000;
const LOGIN_QR_PUSH_MAX_RETRIES = 2;

function fingerprintFileSync(filePath) {
  try {
    const buf = fse.readFileSync(filePath);
    if (!buf || buf.length < 1500) return "";
    return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 24);
  } catch {
    return "";
  }
}

function ensureQrSnifferAttached(page) {
  attachQrDataUrlSniffer(page);
}

function getOrCreateQrState(page) {
  let state = qrDataUrlStateByPage.get(page);
  if (!state) {
    state = {
      dataUrls: [],
      imageResponses: [],
      qrKeyFirstSeenAt: new Map(),
      snifferAttached: false
    };
    qrDataUrlStateByPage.set(page, state);
  } else if (!state.qrKeyFirstSeenAt) {
    state.qrKeyFirstSeenAt = new Map();
  }
  return state;
}

function extractQrDataUrls(text) {
  if (!text || typeof text !== "string") return [];
  const matches =
    text.match(/data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=]+/gi) || [];
  return matches.filter((item) => item.length > 2000);
}

function readPngSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  const pngSignatureHex = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignatureHex) return null;
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { width, height };
}

async function saveDataUrlPng(dataUrl, savePath, options = {}) {
  if (!dataUrl || typeof dataUrl !== "string") return false;
  const matched = dataUrl.match(
    /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i
  );
  if (!matched) return false;
  const minBytes = options.minBytes || 500;
  const minSide = options.minSide || 0;
  const maxAspectDiff =
    typeof options.maxAspectDiff === "number" ? options.maxAspectDiff : 1;
  const base64 = matched[2] || "";
  if (!base64) return false;
  const buf = Buffer.from(base64, "base64");
  if (!buf || buf.length < minBytes) return false;
  if (minSide > 0 && matched[1].toLowerCase() === "png") {
    const size = readPngSize(buf);
    if (size && (size.width < minSide || size.height < minSide)) return false;
    if (size) {
      const ratioDiff =
        Math.abs(size.width - size.height) / Math.max(size.width, size.height);
      if (ratioDiff > maxAspectDiff) return false;
    }
  }
  await fse.writeFile(savePath, buf);
  return true;
}

async function saveImageBuffer(image, savePath, options = {}) {
  const buffer = image?.buffer;
  if (!Buffer.isBuffer(buffer)) return false;
  const minBytes = options.minBytes || 500;
  const minSide = options.minSide || 0;
  const maxAspectDiff =
    typeof options.maxAspectDiff === "number" ? options.maxAspectDiff : 1;
  if (buffer.length < minBytes) return false;

  const contentType = String(image.contentType || "").toLowerCase();
  if (minSide > 0 && contentType.includes("png")) {
    const size = readPngSize(buffer);
    if (size && (size.width < minSide || size.height < minSide)) return false;
    if (size) {
      const ratioDiff =
        Math.abs(size.width - size.height) / Math.max(size.width, size.height);
      if (ratioDiff > maxAspectDiff) return false;
    }
  }

  await fse.writeFile(savePath, buffer);
  return true;
}

function attachQrDataUrlSniffer(page) {
  const state = getOrCreateQrState(page);
  if (state.snifferAttached) return;
  state.snifferAttached = true;

  page.on("response", async (response) => {
    try {
      const url = response.url() || "";
      if (!url.includes("douyin.com")) return;

      const headers = await response.allHeaders().catch(() => ({}));
      const contentType = String(headers["content-type"] || "").toLowerCase();
      const likelyQrImagePayload =
        contentType.startsWith("image/") &&
        /(qr|qrcode|scan|login|passport|verify)/i.test(url);
      if (likelyQrImagePayload) {
        const buffer = await response.body().catch(() => null);
        if (Buffer.isBuffer(buffer) && buffer.length > 1500) {
          state.imageResponses.push({
            buffer,
            contentType,
            capturedAt: Date.now(),
            responseUrl: url
          });
          if (state.imageResponses.length > 4) {
            state.imageResponses = state.imageResponses.slice(-4);
          }
        }
        return;
      }

      const likelyTextPayload =
        contentType.includes("json") ||
        contentType.includes("text") ||
        contentType.includes("javascript") ||
        contentType.includes("html");
      if (!likelyTextPayload) return;

      const text = await response.text().catch(() => "");
      if (!text || text.length < 64) return;
      const urls = extractQrDataUrls(text);
      if (urls.length === 0) return;

      const capturedAt = Date.now();
      for (const item of urls) {
        state.dataUrls.push({ dataUrl: item, capturedAt, responseUrl: url });
      }
      // 只保留最近候选，避免长时间运行内存膨胀。
      if (state.dataUrls.length > 8) {
        state.dataUrls = state.dataUrls.slice(-8);
      }
    } catch {
      // 响应抓取失败不影响主流程
    }
  });
}

function getRecentNetworkQrDataUrls(page, maxAgeMs = NETWORK_QR_MAX_AGE_MS) {
  const state = qrDataUrlStateByPage.get(page);
  const now = Date.now();
  return (state?.dataUrls || [])
    .map((item) => {
      if (typeof item === "string") {
        return { dataUrl: item, capturedAt: 0 };
      }
      return item;
    })
    .filter((item) => {
      if (!item?.dataUrl) return false;
      if (!item.capturedAt) return false;
      return now - item.capturedAt <= maxAgeMs;
    })
    .sort((a, b) => b.capturedAt - a.capturedAt)
    .map((item) => item.dataUrl);
}

function getRecentNetworkQrCandidates(
  page,
  maxAgeMs = NETWORK_QR_MAX_AGE_MS,
  minCapturedAt = 0
) {
  const state = qrDataUrlStateByPage.get(page);
  const now = Date.now();
  const images = (state?.imageResponses || []).map((item) => ({
    ...item,
    type: "image"
  }));
  const dataUrls = (state?.dataUrls || []).map((item) => ({
    ...item,
    type: "dataUrl"
  }));

  return [...images, ...dataUrls]
    .filter((item) => {
      const capturedAt = Number(item?.capturedAt || 0);
      if (!capturedAt || capturedAt < minCapturedAt) return false;
      if (now - capturedAt > maxAgeMs) return false;
      if (item.type === "image") return Buffer.isBuffer(item.buffer);
      return Boolean(item.dataUrl);
    })
    .sort((a, b) => Number(b.capturedAt || 0) - Number(a.capturedAt || 0));
}

async function trackLoginQrVisibility(page, accountName) {
  if (!(await hasVisibleQr(page).catch(() => false))) return;
  const keys = await readLoginQrKeys(page);
  noteCurrentLoginQrKeys(page, keys);
  if (!loginQrFirstSeenAtByAccount.has(accountName)) {
    loginQrFirstSeenAtByAccount.set(accountName, Date.now());
  }
}

function getTrackedLoginQrDomAgeMs(page, accountName) {
  const keys = [];
  const state = qrDataUrlStateByPage.get(page);
  if (state?.qrKeyFirstSeenAt?.size) {
    const now = Date.now();
    for (const key of state.qrKeyFirstSeenAt.keys()) {
      keys.push(now - (state.qrKeyFirstSeenAt.get(key) || now));
    }
  }
  const fromKeys = keys.length ? Math.min(...keys) : 0;
  const fromAccount = loginQrFirstSeenAtByAccount.has(accountName)
    ? Date.now() - loginQrFirstSeenAtByAccount.get(accountName)
    : 0;
  return Math.max(fromKeys, fromAccount);
}

function getLatestNetworkQrCapturedAt(page) {
  const state = qrDataUrlStateByPage.get(page);
  let latest = 0;
  for (const item of state?.dataUrls || []) {
    const capturedAt =
      typeof item === "string" ? 0 : Number(item?.capturedAt || 0);
    latest = Math.max(latest, capturedAt);
  }
  for (const item of state?.imageResponses || []) {
    latest = Math.max(latest, Number(item?.capturedAt || 0));
  }
  return latest;
}

async function readLoginQrKeys(page) {
  return page
    .evaluate(() => {
      const keys = [];
      const seen = new Set();
      const push = (value) => {
        const key = String(value || "").trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        keys.push(key);
      };
      const selectors = [
        "img[aria-label='二维码']",
        "img[src*='qrcode']",
        "img[src^='data:image/']",
        "[class*='qrcode'] img",
        "[aria-label='二维码'] img"
      ];
      for (const selector of selectors) {
        for (const el of Array.from(document.querySelectorAll(selector))) {
          push(el.getAttribute("src") || "");
        }
      }
      return keys;
    })
    .catch(() => []);
}

function noteCurrentLoginQrKeys(page, keys) {
  const state = getOrCreateQrState(page);
  const now = Date.now();
  const current = new Set((keys || []).filter(Boolean));
  for (const key of current) {
    if (!state.qrKeyFirstSeenAt.has(key)) {
      state.qrKeyFirstSeenAt.set(key, now);
    }
  }
  for (const key of Array.from(state.qrKeyFirstSeenAt.keys())) {
    if (!current.has(key)) {
      state.qrKeyFirstSeenAt.delete(key);
    }
  }
  if (current.size === 0) return 0;
  return Math.min(
    ...Array.from(current).map(
      (key) => now - (state.qrKeyFirstSeenAt.get(key) || now)
    )
  );
}

async function openCreatorLoginPanelIfPresent(page, accountName) {
  const alreadyHasQr = await hasVisibleQr(page).catch(() => false);
  if (alreadyHasQr) return false;

  const loginEntry = page.getByText("创作者登录", { exact: true }).first();
  const visible = await loginEntry.isVisible({ timeout: 700 }).catch(() => false);
  if (!visible) return false;

  const waitForQr = async (timeoutMs) =>
    page
      .waitForFunction(
        () => {
          const text = document.body?.innerText || "";
          return Boolean(
            text.includes("扫码登录") ||
              document.querySelector("img[aria-label='二维码']") ||
              document.querySelector("img[src*='qrcode']") ||
              document.querySelector("[class*='qrcode'] img") ||
              document.querySelector("[class*='qrcode'] canvas")
          );
        },
        null,
        { timeout: timeoutMs }
      )
      .then(() => true)
      .catch(() => false);

  await loginEntry.scrollIntoViewIfNeeded().catch(() => {});
  await loginEntry.click({ timeout: 2500 }).catch(async () => {
    await loginEntry.click({ force: true, timeout: 2500 }).catch(() => {});
  });
  if (await waitForQr(4000)) {
    console.log(`账号 [${accountName}] 已打开创作者登录二维码面板。`);
    return true;
  }

  await page
    .evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll("button,a,div,span")
      ).filter((el) => (el.textContent || "").trim() === "创作者登录");
      const target = candidates.find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width >= 80 && rect.height >= 30;
      });
      if (!target) return false;
      target.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window
        })
      );
      return true;
    })
    .catch(() => false);
  if (await waitForQr(5000)) {
    console.log(`账号 [${accountName}] 已通过页面入口打开创作者登录二维码面板。`);
    return true;
  }
  return false;
}

async function waitForLoginQrKeyChange(page, previousKeys, timeoutMs = 5000) {
  const previous = new Set(previousKeys || []);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const current = await readLoginQrKeys(page);
    if (current.some((key) => key && !previous.has(key))) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function refreshLoginQrIfPossible(page, accountName) {
  const beforeKeys = await readLoginQrKeys(page);
  noteCurrentLoginQrKeys(page, beforeKeys);
  const currentDomQrAgeMs = getTrackedLoginQrDomAgeMs(page, accountName);

  const refreshLocators = [
    page.locator("button", { hasText: /刷新|重新获取|重试/ }).first(),
    page.locator("text=/刷新二维码|二维码已失效|点击刷新|重新获取|重试/").first(),
    page.locator("[role='dialog']").getByText(/刷新|重新获取|重试/).first(),
    page.locator("[class*='qrcode']").getByText(/刷新|重新获取|重试/).first()
  ];

  let refreshClicked = false;
  for (const locator of refreshLocators) {
    const visible = await locator.isVisible({ timeout: 350 }).catch(() => false);
    if (!visible) continue;
    refreshClicked = true;
    try {
      await locator.click({ timeout: 1500 });
    } catch {
      await locator.click({ force: true, timeout: 1500 }).catch(() => {});
    }
    const changed = await waitForLoginQrKeyChange(page, beforeKeys, 5000);
    noteCurrentLoginQrKeys(page, await readLoginQrKeys(page));
    console.log(
      `账号 [${accountName}] 已尝试刷新登录二维码${changed ? "，检测到二维码已更新" : "，但未检测到 src 变化"}。`
    );
    await page.waitForTimeout(300);
    if (changed) return true;
    break;
  }

  const latestNetworkQrAt = getLatestNetworkQrCapturedAt(page);
  const hasVisibleLoginQr =
    beforeKeys.length > 0 || (await hasVisibleQr(page).catch(() => false));
  const networkQrStale =
    latestNetworkQrAt > 0 &&
    Date.now() - latestNetworkQrAt > NETWORK_QR_MAX_AGE_MS;
  const domQrStale =
    hasVisibleLoginQr &&
    Number.isFinite(currentDomQrAgeMs) &&
    currentDomQrAgeMs > DOM_QR_MAX_AGE_MS;

  if (
    hasVisibleLoginQr &&
    (networkQrStale || domQrStale || currentDomQrAgeMs >= 8000 || refreshClicked)
  ) {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await openCreatorLoginPanelIfPresent(page, accountName);
    await waitForLoginQrKeyChange(page, beforeKeys, 8000);
    noteCurrentLoginQrKeys(page, await readLoginQrKeys(page));
    loginQrFirstSeenAtByAccount.set(accountName, Date.now());
    console.log(
      `账号 [${accountName}] 已刷新页面以获取新的登录二维码（DOM 已展示 ${(currentDomQrAgeMs / 1000).toFixed(1)}s）。`
    );
    return true;
  }

  return false;
}

async function refreshLoginQrForPush(page, accountName) {
  const beforeKeys = await readLoginQrKeys(page);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await openCreatorLoginPanelIfPresent(page, accountName);
  await waitForLoginQrKeyChange(page, beforeKeys, 8000);
  noteCurrentLoginQrKeys(page, await readLoginQrKeys(page));
  loginQrFirstSeenAtByAccount.set(accountName, Date.now());
  console.log(`账号 [${accountName}] 推送前已刷新页面以获取新登录二维码。`);
}

/**
 * 等待登录二维码对应节点已绘制（避免仅占位白底时截屏）。
 * @returns {Promise<boolean>}
 */
async function waitForLoginQrPaint(locator, page, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await locator
      .evaluate(async (el) => {
        const canvasHasInk = (c) => {
          try {
            if (!c || c.width < 32 || c.height < 32) return false;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            if (!ctx) return false;
            const w = Math.min(96, c.width);
            const h = Math.min(96, c.height);
            const x = Math.floor((c.width - w) / 2);
            const y = Math.floor((c.height - h) / 2);
            const { data } = ctx.getImageData(x, y, w, h);
            let dark = 0;
            const step = 8;
            for (let i = 0; i < data.length; i += 4 * step) {
              if (data[i] < 210 || data[i + 1] < 210 || data[i + 2] < 210) {
                dark += 1;
              }
            }
            const samples = Math.ceil(data.length / (4 * step));
            return samples > 0 && dark / samples > 0.03;
          } catch {
            return false;
          }
        };

        const imgLooksPainted = async (img) => {
          if (!img || img.tagName !== "IMG") return false;
          try {
            if (typeof img.decode === "function") {
              await img.decode();
            }
          } catch {
            // ignore
          }
          if (
            !img.complete ||
            img.naturalWidth < 48 ||
            img.naturalHeight < 48
          ) {
            return false;
          }
          const src = (img.getAttribute("src") || "").trim();
          if (!src || src === "about:blank") return false;
          try {
            const c = document.createElement("canvas");
            const w = Math.min(96, img.naturalWidth);
            const h = Math.min(96, img.naturalHeight);
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d");
            if (!ctx) return true;
            ctx.drawImage(img, 0, 0, w, h);
            const { data } = ctx.getImageData(0, 0, w, h);
            let dark = 0;
            const step = 6;
            for (let i = 0; i < data.length; i += 4 * step) {
              if (data[i] < 220 || data[i + 1] < 220 || data[i + 2] < 220) {
                dark += 1;
              }
            }
            const samples = Math.ceil(data.length / (4 * step));
            return samples > 0 && dark / samples > 0.02;
          } catch {
            // 跨域污染画布时仅能依赖尺寸与 complete
            return true;
          }
        };

        if (!el) return false;
        const tag = el.tagName && el.tagName.toLowerCase();
        if (tag === "img") return imgLooksPainted(el);
        if (tag === "canvas") return canvasHasInk(el);

        const innerImg =
          el.querySelector(
            "img[aria-label='二维码'],img[src*='qrcode'],img[src^='data:image/']"
          ) || el.querySelector("img");
        if (innerImg && (await imgLooksPainted(innerImg))) return true;

        const innerCanvas = el.querySelector("canvas");
        if (innerCanvas && canvasHasInk(innerCanvas)) return true;

        return false;
      })
      .catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(220);
  }
  return false;
}

async function pollTryCaptureQrFromDataUrl(
  page,
  screenshotPath,
  totalMs = 8000,
  minCapturedAt = 0
) {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    if (await tryCaptureQrFromDataUrl(page, screenshotPath, minCapturedAt)) {
      return true;
    }
    await page.waitForTimeout(350);
  }
  return false;
}

async function pollTryCaptureQrFromNetwork(
  page,
  screenshotPath,
  totalMs = NETWORK_QR_CAPTURE_WAIT_MS,
  minCapturedAt = 0
) {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    const candidates = getRecentNetworkQrCandidates(
      page,
      NETWORK_QR_MAX_AGE_MS,
      minCapturedAt
    );
    for (const item of candidates) {
      const ok =
        item.type === "image"
          ? await saveImageBuffer(item, screenshotPath, {
              minBytes: 1500,
              minSide: 180,
              maxAspectDiff: 0.25
            }).catch(() => false)
          : await saveDataUrlPng(item.dataUrl, screenshotPath, {
              minBytes: 1500,
              minSide: 180,
              maxAspectDiff: 0.25
            }).catch(() => false);
      if (ok) return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function tryCaptureQrFromDataUrl(page, screenshotPath, minCapturedAt = 0) {
  // 1) 优先从 DOM 提取当前二维码 dataURL，避免受视口裁切影响。
  const ariaQrSrc = await page
    .evaluate(() => {
      const el = document.querySelector("img[aria-label='二维码']");
      if (!el || !el.getAttribute) return "";
      return el.getAttribute("src") || "";
    })
    .catch(() => "");
  if (
    await saveDataUrlPng(ariaQrSrc, screenshotPath, {
      minBytes: 1500,
      minSide: 180,
      maxAspectDiff: 0.25
    }).catch(() => false)
  ) {
    return true;
  }

  // 2) 再从 DOM 提取其余二维码 dataURL。
  const domDataUrls = await page
    .evaluate(() => {
      const all = [];
      const pushUnique = (src) => {
        if (!src || typeof src !== "string") return;
        if (!/^data:image\/(?:png|jpe?g);base64,/i.test(src)) return;
        if (src.length < 2000) return;
        if (!all.includes(src)) all.push(src);
      };
      const selectors = [
        "[class*='animate_qrcode_container'] [class*='qrcode_img'][src^='data:image/']",
        "[class*='animate_qrcode'] [class*='qrcode_img'][src^='data:image/']",
        "img[aria-label='二维码'][src^='data:image/']",
        "[aria-label='二维码'] img[src^='data:image/']",
        "[class*='qrcode'] img[src^='data:image/']"
      ];
      for (const selector of selectors) {
        const nodeList = document.querySelectorAll(selector);
        for (const el of nodeList) {
          const src = el && el.getAttribute ? el.getAttribute("src") : "";
          pushUnique(src);
        }
      }
      return all;
    })
    .catch(() => []);
  for (const item of domDataUrls) {
    const ok = await saveDataUrlPng(item, screenshotPath, {
      minBytes: 1500,
      minSide: 180,
      maxAspectDiff: 0.25
    }).catch(() => false);
    if (ok) {
      return true;
    }
  }

  // 3) 兜底使用刷新后的网络 dataURL（不接受刷新前的缓存）
  const candidates = getRecentNetworkQrCandidates(
    page,
    NETWORK_QR_MAX_AGE_MS,
    minCapturedAt
  )
    .filter((item) => item.type === "dataUrl")
    .map((item) => item.dataUrl);
  for (const item of candidates) {
    const ok = await saveDataUrlPng(item, screenshotPath, {
      minBytes: 1500,
      minSide: 180,
      maxAspectDiff: 0.25
    }).catch(() => false);
    if (ok) {
      return true;
    }
  }
  return false;
}

async function hasVisibleQr(page) {
  const qrSelectors = [
    "img[src*='qrcode']",
    "img[alt*='二维码']",
    "[class*='qrcode'] img",
    "[class*='qrcode'] canvas",
    "[aria-label='二维码']",
    "div:has-text('扫码登录') canvas",
    "[role='dialog'] canvas"
  ];
  for (const selector of qrSelectors) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (visible) {
      return true;
    }
  }
  return false;
}

async function tryCaptureFreshLoginQr(page, screenshotPath, qrFreshStartAt) {
  if (
    await pollTryCaptureQrFromNetwork(
      page,
      screenshotPath,
      NETWORK_QR_CAPTURE_WAIT_MS,
      qrFreshStartAt
    )
  ) {
    return "network";
  }

  if (
    await pollTryCaptureQrFromDataUrl(
      page,
      screenshotPath,
      8000,
      qrFreshStartAt
    )
  ) {
    return "dom";
  }

  if (!(await hasVisibleQr(page).catch(() => false))) {
    return "";
  }

  const clipAroundBox = (box, viewport, pad = 18) => {
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    const width = Math.max(
      1,
      Math.min(Math.ceil(box.width + pad * 2), viewport.width - x)
    );
    const height = Math.max(
      1,
      Math.min(Math.ceil(box.height + pad * 2), viewport.height - y)
    );
    return { x, y, width, height };
  };

  const isBoxLikelyClipped = (box, viewport) => {
    if (!box || !viewport) return false;
    if (box.x < 4 || box.y < 4) return true;
    if (box.x + box.width > viewport.width - 4) return true;
    if (box.y + box.height > viewport.height - 4) return true;
    return false;
  };

  const setPageZoom = async (zoom) => {
    await page
      .evaluate((z) => {
        document.body.style.zoom = String(z);
      }, zoom)
      .catch(() => {});
  };

  const ensureWideViewport = async (minWidth = 1500, minHeight = 900) => {
    const viewport = page.viewportSize() || BROWSER_VIEWPORT;
    const nextViewport = {
      width: Math.max(viewport.width, minWidth),
      height: Math.max(viewport.height, minHeight)
    };
    if (
      nextViewport.width === viewport.width &&
      nextViewport.height === viewport.height
    ) {
      return viewport;
    }
    await page.setViewportSize(nextViewport).catch(() => {});
    await page.waitForTimeout(180);
    return page.viewportSize() || nextViewport;
  };

  const tryCaptureLocator = async (locator) => {
    const visible = await locator.isVisible({ timeout: 1200 }).catch(() => false);
    if (!visible) return false;

    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const painted = await waitForLoginQrPaint(locator, page, 10000);
    if (!painted) return false;
    await page.waitForTimeout(100);

    let viewport = page.viewportSize() || BROWSER_VIEWPORT;
    let box = await locator.boundingBox().catch(() => null);
    if (!box) return false;
    if (box.width < 120 || box.height < 120) return false;
    const ratioDiff =
      Math.abs(box.width - box.height) / Math.max(box.width, box.height);
    if (ratioDiff > 0.4) return false;

    if (isBoxLikelyClipped(box, viewport)) {
      await setPageZoom(0.9);
      await page.waitForTimeout(180);
      box = await locator.boundingBox().catch(() => box);
    }

    if (!box || isBoxLikelyClipped(box, viewport)) {
      viewport = await ensureWideViewport();
      box = await locator.boundingBox().catch(() => box);
    }

    if (!box || isBoxLikelyClipped(box, viewport)) {
      return false;
    }

    const clip = clipAroundBox(box, viewport, 70);
    await page.screenshot({ path: screenshotPath, clip }).catch(() => {});
    if (await fse.pathExists(screenshotPath)) {
      return true;
    }
    await locator.screenshot({ path: screenshotPath }).catch(() => {});
    return fse.pathExists(screenshotPath);
  };

  const qrSelectors = [
    "img[aria-label='二维码']",
    "div:has-text('扫码登录') img[src*='qrcode']",
    "div:has-text('扫码登录') canvas",
    "[role='dialog'] img[src*='qrcode']",
    "[role='dialog'] canvas",
    "img[src*='qrcode']",
    "img[alt*='二维码']",
    "[class*='qrcode'] img",
    "[class*='qrcode'] canvas",
    "[aria-label='二维码']"
  ];

  for (const selector of qrSelectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 6);
    for (let i = 0; i < count; i += 1) {
      if (await tryCaptureLocator(locator.nth(i))) {
        return "clip";
      }
    }
  }

  return "";
}

async function captureLoginQrScreenshot(page, paths, accountName) {
  ensureQrSnifferAttached(page);
  await fse.ensureDir(paths.alertDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(paths.alertDir, `${timestamp}-login-qr.png`);
  const lastPushedFingerprint =
    lastPushedLoginQrFingerprintByAccount.get(accountName) || "";

  for (let attempt = 0; attempt <= LOGIN_QR_PUSH_MAX_RETRIES; attempt += 1) {
    await openCreatorLoginPanelIfPresent(page, accountName);
    await refreshLoginQrForPush(page, accountName);

    const qrFreshStartAt = Date.now();
    await page.waitForTimeout(500);

    const captureMethod = await tryCaptureFreshLoginQr(
      page,
      screenshotPath,
      qrFreshStartAt
    );
    if (!captureMethod) {
      console.warn(
        `账号 [${accountName}] 第 ${attempt + 1} 次未捕获到有效登录二维码。`
      );
      continue;
    }

    const fingerprint = fingerprintFileSync(screenshotPath);
    if (!fingerprint || fingerprint.length < 8) {
      console.warn(
        `账号 [${accountName}] 第 ${attempt + 1} 次捕获到的二维码文件无效。`
      );
      continue;
    }

    if (
      fingerprint === lastPushedFingerprint &&
      attempt < LOGIN_QR_PUSH_MAX_RETRIES
    ) {
      console.warn(
        `账号 [${accountName}] 捕获到的二维码与上次推送相同，将强制刷新后重试 (${attempt + 1}/${LOGIN_QR_PUSH_MAX_RETRIES + 1})。`
      );
      continue;
    }

    lastPushedLoginQrFingerprintByAccount.set(accountName, fingerprint);
    loginQrFirstSeenAtByAccount.delete(accountName);
    console.log(
      `账号 [${accountName}] 已保存新登录二维码 (${captureMethod}): ${screenshotPath}`
    );
    return screenshotPath;
  }

  console.warn(`账号 [${accountName}] 多次尝试后仍未能捕获有效登录二维码。`);
  return null;
}

module.exports = {
  attachQrDataUrlSniffer,
  ensureQrSnifferAttached,
  captureLoginQrScreenshot,
  hasVisibleQr,
  trackLoginQrVisibility
};
