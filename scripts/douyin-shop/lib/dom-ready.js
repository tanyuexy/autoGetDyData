const { DOM_LOAD_TIMEOUT_MS } = require("./env");

/**
 * 等待页面触发 load 事件（DOM 与样式表、图片等子资源按浏览器规则加载完毕）。
 * 超时仅告警不抛错，避免偶发慢资源阻断流程。
 *
 * @param {import('playwright').Page} page
 * @param {{ tag?: string, timeoutMs?: number }} [options]
 * @returns {Promise<boolean>}
 */
async function waitForDomLoaded(page, options = {}) {
  const tag = options.tag || "dom";
  const timeout = options.timeoutMs ?? DOM_LOAD_TIMEOUT_MS;
  try {
    await page.waitForLoadState("load", { timeout });
    return true;
  } catch (error) {
    const msg = error?.message || String(error);
    console.warn(
      `[${tag}] 等待 DOM load 超时（${timeout}ms），继续: ${msg}`
    );
    return false;
  }
}

module.exports = { waitForDomLoaded };
