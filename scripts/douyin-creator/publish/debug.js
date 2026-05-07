const path = require("path");
const { ensureDir } = require("../../common/fs");

const PUBLISH_DEBUG_DIR = path.resolve(
  process.env.CREATOR_PUBLISH_DEBUG_DIR ||
    path.join(process.cwd(), "storage/creator-publish-debug")
);

async function saveDebugArtifacts(page, accountName, tag) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeAccount = String(accountName || "unknown").replace(/[\\/:*?"<>|]/g, "_");
  const dir = path.join(PUBLISH_DEBUG_DIR, safeAccount);
  await ensureDir(dir);

  const htmlPath = path.join(dir, `${stamp}-${tag}.html`);
  const screenshotPath = path.join(dir, `${stamp}-${tag}.png`);

  try {
    const html = await page.content();
    require("fs").writeFileSync(htmlPath, html, "utf-8");
  } catch {}

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch {}

  console.log(`已保存调试文件: ${htmlPath}`);
  console.log(`已保存调试截图: ${screenshotPath}`);
}

module.exports = {
  PUBLISH_DEBUG_DIR,
  saveDebugArtifacts,
};
