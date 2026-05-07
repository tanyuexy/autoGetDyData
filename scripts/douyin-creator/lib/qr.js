const fs = require("fs/promises");
const path = require("path");
const { ensureDir, fileExists } = require("../../common/fs");
const { BROWSER_VIEWPORT } = require("./env");

const qrDataUrlStateByPage = new WeakMap();

function extractQrDataUrls(text) {
  if (!text || typeof text !== "string") return [];
  const matches =
    text.match(/data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=]+/gi) || [];
  return matches.filter((item) => item.length > 4000);
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
  await fs.writeFile(savePath, buf);
  return true;
}

function attachQrDataUrlSniffer(page) {
  if (qrDataUrlStateByPage.has(page)) return;
  const state = { dataUrls: [] };
  qrDataUrlStateByPage.set(page, state);

  page.on("response", async (response) => {
    try {
      const url = response.url() || "";
      if (!url.includes("douyin.com")) return;

      const headers = await response.allHeaders().catch(() => ({}));
      const contentType = String(headers["content-type"] || "").toLowerCase();
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

      for (const item of urls) {
        state.dataUrls.push(item);
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

async function tryCaptureQrFromDataUrl(page, screenshotPath) {
  // 1) 第一优先：直接使用 img[aria-label='二维码'] 的 src。
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

  // 2) 优先从 DOM 提取其余二维码 dataURL，避免受视口裁切影响。
  const domDataUrls = await page
    .evaluate(() => {
      const all = [];
      const pushUnique = (src) => {
        if (!src || typeof src !== "string") return;
        if (!/^data:image\/(?:png|jpe?g);base64,/i.test(src)) return;
        if (src.length < 4000) return;
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

  // 3) 再尝试从网络响应缓存中提取 dataURL。
  const state = qrDataUrlStateByPage.get(page);
  const candidates = (state?.dataUrls || [])
    .slice()
    .sort((a, b) => b.length - a.length);
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

async function tryCaptureFaceQrFromDom(page, screenshotPath) {
  const domDataUrls = await page
    .evaluate(() => {
      const urls = [];
      const seen = new Set();
      const imgs = Array.from(
        document.querySelectorAll("img[aria-label='二维码'][src^='data:image/']")
      );
      for (const img of imgs) {
        const parent = img.parentElement;
        const container = parent?.parentElement || parent;
        if (!parent || !container) continue;

        let hasHowToScanSibling = false;
        for (const node of Array.from(container.children)) {
          if (node === parent || node === img) continue;
          const text = (node.textContent || "").replace(/\s+/g, "");
          if (text.includes("如何扫码")) {
            hasHowToScanSibling = true;
            break;
          }
        }
        if (!hasHowToScanSibling) continue;

        const src = img.getAttribute("src") || "";
        if (!/^data:image\/(?:png|jpe?g);base64,/i.test(src)) continue;
        if (!src || src.length < 4000) continue;
        if (seen.has(src)) continue;
        seen.add(src);
        urls.push(src);
      }
      return urls;
    })
    .catch(() => []);

  for (const item of domDataUrls) {
    const ok = await saveDataUrlPng(item, screenshotPath, {
      minBytes: 1500,
      minSide: 180,
      maxAspectDiff: 0.25
    }).catch(() => false);
    if (ok) return true;
  }
  return false;
}

async function captureVerifyDialogScreenshot(page, paths, accountName, suffix) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(paths.alertDir, `${timestamp}-${suffix}.png`);
  const dialog = page.locator("[role='dialog']").last();
  const dialogVisible = await dialog
    .isVisible({ timeout: 800 })
    .catch(() => false);
  if (dialogVisible) {
    await dialog.screenshot({ path: screenshotPath }).catch(() => {});
  }
  if (!(await fileExists(screenshotPath))) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  }
  console.log(`账号 [${accountName}] 已保存验证截图: ${screenshotPath}`);
  return screenshotPath;
}

async function captureFaceQrScreenshot(page, paths, accountName) {
  await ensureDir(paths.alertDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(
    paths.alertDir,
    `${timestamp}-face-verify.png`
  );

  if (await tryCaptureFaceQrFromDom(page, screenshotPath)) {
    console.log(
      `账号 [${accountName}] 已通过 DOM 保存刷脸二维码: ${screenshotPath}`
    );
    return screenshotPath;
  }

  const clipAroundBox = (box, viewport, pad = 14) => {
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

  const tryCaptureLocator = async (locator) => {
    const visible = await locator.isVisible({ timeout: 800 }).catch(() => false);
    if (!visible) return false;

    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(120);

    const box = await locator.boundingBox().catch(() => null);
    if (!box) return false;
    if (box.width < 100 || box.height < 100) return false;

    const ratioDiff =
      Math.abs(box.width - box.height) / Math.max(box.width, box.height);
    if (ratioDiff > 0.3) return false;

    const viewport = page.viewportSize() || BROWSER_VIEWPORT;
    const clip = clipAroundBox(box, viewport, 14);
    await page.screenshot({ path: screenshotPath, clip }).catch(() => {});
    if (await fileExists(screenshotPath)) {
      return true;
    }

    await locator.screenshot({ path: screenshotPath }).catch(() => {});
    return fileExists(screenshotPath);
  };

  const qrSelectors = [
    "#uc_verification_animate_qrcode_container img[aria-label='二维码']",
    "[id*='uc_verification_animate_qrcode_container'] img[aria-label='二维码']",
    "div:has-text('手机刷脸验证') img[aria-label='二维码']",
    "div:has-text('如何扫码') ~ div img[aria-label='二维码']",
    "div:has-text('手机刷脸验证') [class*='animate_qrcode_container'] img",
    "div:has-text('手机刷脸验证') [class*='qrcode'] img",
    "div:has-text('手机刷脸验证') [class*='qrcode'] canvas",
    "img[aria-label='二维码']",
    "img[src*='qrcode']",
    "[class*='qrcode'] img",
    "[class*='qrcode'] canvas",
    "canvas"
  ];

  for (const selector of qrSelectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 4);
    for (let i = 0; i < count; i += 1) {
      if (await tryCaptureLocator(locator.nth(i))) {
        console.log(
          `账号 [${accountName}] 已保存刷脸二维码截图: ${screenshotPath}`
        );
        return screenshotPath;
      }
    }
  }

  const faceDialog = page
    .locator("[role='dialog']")
    .filter({ hasText: "手机刷脸验证" })
    .last();
  const dialogVisible = await faceDialog
    .isVisible({ timeout: 600 })
    .catch(() => false);
  if (dialogVisible) {
    await faceDialog.screenshot({ path: screenshotPath }).catch(() => {});
    if (await fileExists(screenshotPath)) {
      console.log(
        `账号 [${accountName}] 已保存刷脸验证弹窗截图: ${screenshotPath}`
      );
      return screenshotPath;
    }
  }

  return captureVerifyDialogScreenshot(page, paths, accountName, "face-verify");
}

async function hasVisibleQr(page) {
  const qrSelectors = [
    "img[src*='qrcode']",
    "img[alt*='二维码']",
    "[class*='qrcode'] img",
    "[class*='qrcode'] canvas",
    "canvas"
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

async function captureLoginQrScreenshot(page, paths, accountName) {
  await ensureDir(paths.alertDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(paths.alertDir, `${timestamp}-login-qr.png`);
  await page.waitForTimeout(1500);

  if (await tryCaptureQrFromDataUrl(page, screenshotPath)) {
    console.log(
      `账号 [${accountName}] 已通过 DOM dataURL 保存二维码: ${screenshotPath}`
    );
    return screenshotPath;
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
    await page.waitForTimeout(120);

    let viewport = page.viewportSize() || BROWSER_VIEWPORT;
    let box = await locator.boundingBox().catch(() => null);
    if (!box) return false;
    if (box.width < 120 || box.height < 120) return false;
    const ratioDiff =
      Math.abs(box.width - box.height) / Math.max(box.width, box.height);
    if (ratioDiff > 0.4) return false;

    // 某些窗口尺寸下二维码会贴着右边界，先缩放页面再重算位置，避免截图被裁掉。
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
      const fullPagePath = screenshotPath.replace(
        /-login-qr\.png$/,
        "-login-fullpage.png"
      );
      await page.screenshot({ path: fullPagePath, fullPage: true }).catch(() => {});
      return false;
    }

    const clip = clipAroundBox(box, viewport, 70);
    await page.screenshot({ path: screenshotPath, clip }).catch(() => {});
    if (await fileExists(screenshotPath)) {
      return true;
    }
    await locator.screenshot({ path: screenshotPath }).catch(() => {});
    return fileExists(screenshotPath);
  };

  const qrSelectors = [
    "[aria-label='二维码']",
    "div:has-text('扫码登录') img[src*='qrcode']",
    "div:has-text('扫码登录') canvas",
    "[role='dialog'] img[src*='qrcode']",
    "[role='dialog'] canvas",
    "img[src*='qrcode']",
    "img[alt*='二维码']",
    "[class*='qrcode'] img",
    "[class*='qrcode'] canvas"
  ];

  for (const selector of qrSelectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 6);
    for (let i = 0; i < count; i += 1) {
      if (await tryCaptureLocator(locator.nth(i))) {
        console.log(`账号 [${accountName}] 已保存二维码截图: ${screenshotPath}`);
        return screenshotPath;
      }
    }
  }

  const loginTitle = page.getByText("扫码登录").first();
  const loginTitleVisible = await loginTitle
    .isVisible({ timeout: 600 })
    .catch(() => false);
  if (loginTitleVisible) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    if (await fileExists(screenshotPath)) {
      console.log(
        `账号 [${accountName}] 已保存扫码登录全屏截图: ${screenshotPath}`
      );
      return screenshotPath;
    }
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(`账号 [${accountName}] 已保存登录截图: ${screenshotPath}`);
  return screenshotPath;
}

module.exports = {
  attachQrDataUrlSniffer,
  captureLoginQrScreenshot,
  captureVerifyDialogScreenshot,
  captureFaceQrScreenshot,
  hasVisibleQr
};

