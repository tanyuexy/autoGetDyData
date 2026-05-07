/**
 * 网络韧性工具集。
 * 抖店/罗盘 SPA 多段重定向频繁触发 ERR_ABORTED，
 * 网络波动导致 ERR_TIMED_OUT/ERR_FAILED/ERR_NETWORK_CHANGED。
 * 本模块提供带重试的 goto / download 包装器。
 */

const NETWORK_ERROR_PATTERNS = [
  "ERR_ABORTED",
  "ERR_TIMED_OUT",
  "ERR_NETWORK_CHANGED",
  "ERR_FAILED",
  "ERR_CONNECTION_CLOSED",
  "ERR_CONNECTION_REFUSED",
  "ERR_NAME_NOT_RESOLVED",
  "ERR_INTERNET_DISCONNECTED",
  "net::ERR_",
  "TimeoutError"
];

function isNetworkError(error) {
  const msg = (error && error.message) ? String(error.message) : "";
  if (!msg) return false;
  return NETWORK_ERROR_PATTERNS.some((p) => msg.includes(p));
}

/** 轻微随机退避：base * (1 + random 0~0.3) */
function backoffMs(base, attempt) {
  const factor = Math.min(attempt, 3) * 1.5;
  const jitter = Math.random() * 0.3 + 1;
  return Math.round(base * factor * jitter);
}

/**
 * 带重试的 page.goto()。
 * 网络类错误自动退避重试；重试间隙检查 URL 是否已意外到达目标域。
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.maxRetries=2]       最大重试次数
 * @param {number} [opts.baseBackoff=1200]   基础退避 ms
 * @param {string} [opts.waitUntil="domcontentloaded"]
 * @param {number} [opts.timeout=20000]
 * @param {RegExp} [opts.expectedUrlRe]      可选：重试前检查 URL 是否已满足条件
 * @return {Promise<boolean>} 成功返回 true
 */
async function retryableGoto(page, url, opts = {}) {
  const maxRetries = opts.maxRetries ?? 2;
  const baseBackoff = opts.baseBackoff ?? 1200;
  const waitUntil = opts.waitUntil ?? "domcontentloaded";
  const timeout = opts.timeout ?? 20000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil, timeout });
      return true;
    } catch (error) {
      const netErr = isNetworkError(error);
      const isLast = attempt >= maxRetries;
      const curUrl = (await page.url().catch(() => "")) || "";

      if (opts.expectedUrlRe && opts.expectedUrlRe.test(curUrl)) {
        console.warn(
          `[network] goto(${url.slice(0, 50)}) 抛错但 URL 已到达目标域(${curUrl.slice(0, 50)})，视为成功`
        );
        return true;
      }

      if (!netErr || isLast) {
        if (isLast && netErr) {
          console.error(
            `[network] goto(${url.slice(0, 50)}) 重试 ${maxRetries} 次后仍失败: ${error.message}`
          );
        }
        throw error;
      }

      const delay = backoffMs(baseBackoff, attempt);
      console.warn(
        `[network] goto(${url.slice(0, 50)}) 网络错误第 ${attempt + 1}/${maxRetries} 次重试，${delay}ms 后重试: ${error.message.slice(0, 100)}`
      );
      await page.waitForTimeout(delay).catch(() => {});
    }
  }
  return false;
}

/**
 * 带重试的下载等待。
 *
 * @param {import('playwright').Page} page
 * @param {function} clickFn      执行点击的函数（含 page.locator.click）
 * @param {object} [opts]
 * @param {number} [opts.timeout=60000]   下载超时 ms
 * @param {number} [opts.maxRetries=1]    点击+等待失败后的重试次数
 * @param {number} [opts.retryDelay=2000] 重试间隔 ms
 * @return {Promise<import('playwright').Download>}
 */
async function retryableDownload(page, clickFn, opts = {}) {
  const timeout = opts.timeout ?? 60000;
  const maxRetries = opts.maxRetries ?? 1;
  const retryDelay = opts.retryDelay ?? 2000;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const dlPromise = page.waitForEvent("download", { timeout }).catch(() => null);
    try {
      await clickFn();
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      lastError = e;
      await page.waitForTimeout(retryDelay).catch(() => {});
      continue;
    }

    const dl = await dlPromise;
    if (dl) return dl;

    lastError = new Error(`waitForEvent("download") 在 ${timeout}ms 内未触发`);
    if (attempt >= maxRetries) throw lastError;

    console.warn(
      `[network] 下载未触发，第 ${attempt + 1}/${maxRetries} 次重试，${retryDelay}ms 后重试`
    );
    await page.waitForTimeout(retryDelay).catch(() => {});
  }
  throw lastError;
}

module.exports = {
  retryableGoto,
  retryableDownload,
  isNetworkError
};
