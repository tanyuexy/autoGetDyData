const fs = require("fs/promises");
const path = require("path");
const { fileExists } = require("./fs-utils");
const { clickIfVisible } = require("./login");

async function saveAuth(context, paths, accountName) {
  const cookies = await context.cookies();
  await context.storageState({ path: paths.storageStatePath });
  await fs.writeFile(paths.cookiesPath, JSON.stringify(cookies, null, 2), "utf-8");
  console.log(`账号 [${accountName}] 登录态已保存:`);
  console.log(`- storageState: ${paths.storageStatePath}`);
  console.log(`- cookies: ${paths.cookiesPath}`);
  console.log(`- cookie 数量: ${cookies.length}`);
}

async function exportPostListData(page, paths, accountName) {
  const tabClicked =
    (await clickIfVisible(page.getByRole("tab", { name: "投稿列表" }), 2500)) ||
    (await clickIfVisible(page.getByText("投稿列表"), 2500));

  if (!tabClicked) {
    throw new Error("未找到“投稿列表”标签，请确认页面结构是否变化。");
  }

  await page.waitForTimeout(800);

  let exportBtn = page.getByRole("button", { name: /导出/ }).first();
  const roleBtnVisible = await exportBtn
    .isVisible({ timeout: 2500 })
    .catch(() => false);
  if (!roleBtnVisible) {
    exportBtn = page.locator("button:has-text('导出数据')").first();
  }

  if (!(await exportBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error("未找到“导出”按钮，请确认账号权限或页面加载状态。");
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await exportBtn.click();
  const download = await downloadPromise;

  const rawName =
    download.suggestedFilename() || `douyin-content-${Date.now()}.xlsx`;
  const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const savePath = path.join(paths.dataDir, `${timestamp}-${safeName}`);
  await download.saveAs(savePath);

  if (!(await fileExists(savePath))) {
    console.log(`账号 [${accountName}] 提示：文件已触发下载，但未检测到落盘。`);
  }

  console.log(`账号 [${accountName}] 导出成功:`);
  console.log(`- 文件路径: ${savePath}`);
}

module.exports = { saveAuth, exportPostListData };

