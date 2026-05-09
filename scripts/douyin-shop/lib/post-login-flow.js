const path = require("path");
const fs = require("fs/promises");
const {
  selectShopIfPicker,
  loadPreferredShopNames,
} = require("./shop-picker");
const { gotoVideoSelf, downloadVideoSelfDetail } = require("./video-detail");
const { downloadGraphicDetail } = require("./graphic-detail");
const { switchToNextPreferredShop } = require("./shop-switch");
const { waitForDomLoaded } = require("./page-utils");
const {
  STAGES,
  detectStage,
} = require("./page-utils");

async function saveStorageState(context, paths) {
  await context.storageState({ path: paths.storageStatePath });
  try {
    const state = JSON.parse(
      await fs.readFile(paths.storageStatePath, "utf-8")
    );
    await fs.writeFile(
      paths.cookiesPath,
      JSON.stringify(state.cookies || [], null, 2),
      "utf-8"
    );
  } catch {
  }
}

async function captureFailureShot(page, debugDir, kind) {
  try {
    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    const shot = path.join(debugDir, `${kind}-${ts}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    return shot;
  } catch {
    return null;
  }
}

/**
 * 下载当前店铺的短视频明细 + 图文明细；二者独立 try/catch，互不影响。
 * 店铺名只使用上游传入的目标店铺名。
 */
async function downloadCurrentShop(page, tag, paths, options = {}) {
  const shopName = String(options.shopNameHint || "").trim();
  if (shopName) {
    console.log(`[${tag}] 当前目标店铺: ${shopName}`);
  } else {
    console.warn(`[${tag}] 缺少上游目标店铺名，将以 "unknown" 归档`);
  }

  const shopTag = shopName ? `${tag}|${shopName}` : tag;
  const sn = shopName || "unknown";
  const daysToExport = options.daysToExport || 1;
  const exportBatchId = options.exportBatchId || null;

  let videoPaths = [];
  let graphicPaths = [];
  let videoError;
  let graphicError;
  let videoDateMismatches = [];
  let graphicDateMismatches = [];
  const allFailures = [];

  try {
    const result = await downloadVideoSelfDetail(page, {
      tag: shopTag,
      saveDir: paths.dataDir,
      shopName: sn,
      daysToExport,
      exportBatchId
    });
    if (result.failures && result.failures.length) {
      allFailures.push(...result.failures);
    }
    if (result.allResults) {
      videoPaths = result.allResults
        .filter((r) => r.dateMatch !== false)
        .map((r) => r.savePath)
        .filter(Boolean);
      videoDateMismatches = result.allResults
        .filter((r) => r.dateMatch === false)
        .map((r) => r.dataDate || r.expectedDate || "unknown");
    } else if (result.savePath) {
      videoPaths = [result.savePath];
    }
  } catch (error) {
    videoError = error?.message || String(error);
    console.error(`[${shopTag}] 视频明细下载失败: ${videoError}`);
    const shot = await captureFailureShot(
      page,
      paths.debugDir,
      "download-video-failed"
    );
    if (shot) console.error(`[${shopTag}] 失败截图: ${shot}`);
  }

  try {
    const result = await downloadGraphicDetail(page, {
      tag: shopTag,
      saveDir: paths.dataDir,
      shopName: sn,
      daysToExport,
      exportBatchId
    });
    if (result.failures && result.failures.length) {
      allFailures.push(...result.failures);
    }
    if (result.allResults) {
      graphicPaths = result.allResults
        .filter((r) => r.dateMatch !== false)
        .map((r) => r.savePath)
        .filter(Boolean);
      graphicDateMismatches = result.allResults
        .filter((r) => r.dateMatch === false)
        .map((r) => r.dataDate || r.expectedDate || "unknown");
    } else if (result.savePath) {
      graphicPaths = [result.savePath];
    }
  } catch (error) {
    graphicError = error?.message || String(error);
    console.error(`[${shopTag}] 图文明细下载失败: ${graphicError}`);
    const shot = await captureFailureShot(
      page,
      paths.debugDir,
      "download-graphic-failed"
    );
    if (shot) console.error(`[${shopTag}] 失败截图: ${shot}`);
  }

  const ok = videoPaths.length === daysToExport && graphicPaths.length === daysToExport;
  const parts = [videoError, graphicError].filter(Boolean);

  const videoDaysOk = videoError ? 0 : videoPaths.length;
  const graphicDaysOk = graphicError ? 0 : graphicPaths.length;
  const dateMismatchWarn = [];
  if (videoDateMismatches.length) dateMismatchWarn.push(`视频日期不符: ${videoDateMismatches.join(', ')}`);
  if (graphicDateMismatches.length) dateMismatchWarn.push(`图文日期不符: ${graphicDateMismatches.join(', ')}`);
  const dateOk = videoDateMismatches.length === 0 && graphicDateMismatches.length === 0;
  const failedStepsDetail = [];
  if (allFailures.length) {
    const counts = {};
    for (const f of allFailures) {
      counts[f.step] = (counts[f.step] || 0) + 1;
    }
    for (const [step, n] of Object.entries(counts)) {
      failedStepsDetail.push(`${step}(${n}次)`);
    }
  }

  console.log(
    `[${shopTag}] ─── 导出汇总: 视频 ${videoDaysOk}/${daysToExport}天 ${videoDaysOk === daysToExport ? '✓' : '✗'} | ` +
    `图文 ${graphicDaysOk}/${daysToExport}天 ${graphicDaysOk === daysToExport ? '✓' : '✗'}` +
    (!dateOk ? ` | ⚠ ${dateMismatchWarn.join('; ')}` : '') +
    (videoError ? ` | 视频错误: ${videoError}` : '') +
    (graphicError ? ` | 图文错误: ${graphicError}` : '') +
    (failedStepsDetail.length ? ` | 表单失败项: ${failedStepsDetail.join(', ')}` : '')
  );

  return {
    ok,
    shopName,
    videoDays: videoDaysOk,
    graphicDays: graphicDaysOk,
    daysToExport,
    videoPath: videoPaths[0] || null,
    graphicPath: graphicPaths[0] || null,
    videoError,
    graphicError,
    videoDateMismatches,
    graphicDateMismatches,
    downloadPath: videoPaths[0] || graphicPaths[0] || null,
    error: parts.length ? parts.join("；") : undefined,
    failures: allFailures
  };
}

/**
 * 登录成功后统一执行的后续动作：
 * 1) 若出现「请选择店铺」页，按 config.json accounts 选中第一个匹配项并等待落地稳定
 * 2) 若无选店页（cookie 等），必要时通过「切换数据视角」切到名单中的第一家
 * 3) 每店依次下载短视频明细与图文分析明细，再切到下一个未处理名单店铺重复
 *
 * 每一步都尽量独立捕获异常，避免因后置步骤失败而否定登录动作本身的成果。
 */
async function runPostLoginFlow(page, tag, paths, options = {}) {
  const processed =
    options.processedNames instanceof Set
      ? options.processedNames
      : new Set(options.processedNames || []);

  const result = {
    shopPicked: null,
    shopName: null,
    downloads: [],
    downloadPath: null,
    downloadError: null,
    processedNames: processed
  };

  const selectedShopNames = Array.isArray(options.selectedShopNames)
    ? options.selectedShopNames.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  const fullPreferredList = selectedShopNames.length > 0
    ? selectedShopNames
    : await loadPreferredShopNames();
  const preferredList = fullPreferredList.filter((name) => {
    for (const done of processed) {
      if (!done) continue;
      if (done === name) return false;
      if (name.includes(done) || done.includes(name)) return false;
    }
    return true;
  });
  console.log(
    `[${tag}] 优先级名单总计 ${fullPreferredList.length}，已处理 ${processed.size}，本轮待处理 ${preferredList.length}: ${preferredList.join(", ") || "(空)"}`
  );

  if (preferredList.length === 0) {
    console.log(`[${tag}] 本账号无新店铺可处理，跳过登录后流程`);
    return result;
  }

  const entryStage = await detectStage(page);
  console.log(
    `[${tag}] 进入 post-login 流程，当前阶段=${entryStage.stage} url=${entryStage.url}`
  );

  if (entryStage.stage === STAGES.LOGIN_FORM || entryStage.stage === STAGES.CAPTCHA) {
    console.warn(
      `[${tag}] 意外：post-login 入口仍是 ${entryStage.stage}，终止后续下载流程`
    );
    return result;
  }

  if (entryStage.stage === STAGES.SHOP_PICKER) {
    try {
      const pick = await selectShopIfPicker(page, { tag, preferredList });
      if (pick.picked) {
        result.shopPicked = true;
        result.shopName = pick.name;
      } else {
        result.shopPicked = false;
      }
    } catch (error) {
      console.warn(`[${tag}] 店铺选择阶段异常: ${error.message || error}`);
      result.shopPicked = false;
    }
  } else {
    console.log(
      `[${tag}] 当前阶段=${entryStage.stage}，不在选店页，跳过 selectShopIfPicker`
    );
    result.shopPicked = false;
  }

  function isPreferredShop(shopName) {
    const name = String(shopName || "").trim();
    if (!name) return false;
    return preferredList.some((p) => {
      const pref = String(p || "").trim();
      if (!pref) return false;
      return name === pref || name.includes(pref) || pref.includes(name);
    });
  }

  let pendingShopHint = result.shopName || null;

  if (!result.shopPicked && preferredList.length > 0) {
    const sw = await switchToNextPreferredShop(page, {
      tag,
      processedNames: processed,
      preferredList
    });
    if (!sw.switched && sw.reason === "no-match") {
      console.log(
        `[${tag}] 本账号未命中任何优先级名单店铺（${preferredList.length} 项名单中无可用店铺），跳过下载`
      );
      return result;
    }
    if (sw.switched) {
      pendingShopHint = sw.name || null;
      result.shopName = result.shopName || sw.name || null;
    }
  }

  await waitForDomLoaded(page, { tag });

  try {
    await gotoVideoSelf(page, tag);
  } catch (error) {
    console.warn(
      `[${tag}] 进入短视频明细页失败（仍尝试在下载流程内重试）: ${error.message || error}`
    );
  }

  const maxShops = preferredList.length > 0 ? preferredList.length : 1;

  for (let i = 0; i < maxShops; i += 1) {
    const daysToExport = options.daysToExport || 1;
    const currentTarget = pendingShopHint || "unknown";
    console.log(
      `\n[${tag}] ========== 第 ${i + 1}/${maxShops} 个目标店铺 | 当前目标: ${currentTarget} | 导出天数: ${daysToExport}天 ==========`
    );
    const round = await downloadCurrentShop(page, tag, paths, {
      shopNameHint: pendingShopHint,
      daysToExport,
      exportBatchId: options.exportBatchId || null
    });
    if (round.shopName) {
      processed.add(round.shopName);
      if (!result.shopName) result.shopName = round.shopName;
    }

    if (round.shopName && preferredList.length > 0 && !isPreferredShop(round.shopName)) {
      console.warn(
        `[${tag}] 本轮店铺 "${round.shopName}" 不在优先级名单内，已跳过并结束（仅下载名单店铺）`
      );
      break;
    }

    result.downloads.push({
      shopName: round.shopName,
      videoPath: round.videoPath,
      graphicPath: round.graphicPath,
      videoDays: round.videoDays,
      graphicDays: round.graphicDays,
      daysToExport: round.daysToExport,
      videoError: round.videoError,
      graphicError: round.graphicError,
      failures: round.failures || []
    });
    if (round.videoPath && !result.downloadPath) {
      result.downloadPath = round.videoPath;
    }
    if (round.graphicPath) {
      result.downloadPath = round.graphicPath;
    }
    if (round.videoError && !result.downloadError) {
      result.downloadError = round.videoError;
    }
    if (round.graphicError) {
      result.downloadError = round.graphicError;
    }

    if (round.ok) {
      const failDetail = (round.failures && round.failures.length) ? ` | 表单非致命告警: ${round.failures.length}项` : '';
      console.log(
        `[${tag}] 本轮全部成功: ${round.shopName || "unknown"} | 视频 ${round.videoDays}/${round.daysToExport}天 ✓ | 图文 ${round.graphicDays}/${round.daysToExport}天 ✓${failDetail}`
      );
    } else {
      const detail = [
        round.videoError ? `视频 ✗ ${round.videoError}` : `视频 ${round.videoDays}/${round.daysToExport}天 ✓`,
        round.graphicError ? `图文 ✗ ${round.graphicError}` : `图文 ${round.graphicDays}/${round.daysToExport}天 ✓`
      ].join(" | ");
      const failList = (round.failures && round.failures.length)
        ? ` | 表单失败项: [${round.failures.map((f) => f.step).join(', ')}]`
        : '';
      console.warn(
        `[${tag}] 本轮部分失败: ${round.shopName || "unknown"}（${detail}）${failList}`
      );
    }

    if (preferredList.length === 0) {
      console.log(`[${tag}] 未配置优先级名单，结束循环`);
      break;
    }

    let switchRes;
    try {
      switchRes = await switchToNextPreferredShop(page, {
        tag,
        processedNames: processed,
        preferredList
      });
    } catch (error) {
      console.warn(`[${tag}] 切换店铺阶段异常: ${error.message || error}`);
      await captureFailureShot(page, paths.debugDir, "switch-shop-failed");
      break;
    }

    if (!switchRes.switched) {
      if (switchRes.reason === "no-match") {
        console.log(
          `[${tag}] 切店铺弹窗中已无匹配且未处理的店铺，结束循环（共处理 ${processed.size} 个店铺）`
        );
      } else if (switchRes.reason === "modal-not-opened") {
        console.warn(
          `[${tag}] 右上角菜单中没有"切换数据视角"入口（该账号可能只绑定 1 个自营账号），结束循环`
        );
        await captureFailureShot(page, paths.debugDir, "switch-entry-missing");
      } else {
        console.warn(
          `[${tag}] 未能继续切换店铺（原因: ${switchRes.reason || "unknown"}），结束循环`
        );
      }
      break;
    }

    pendingShopHint = switchRes.name || null;
    console.log(
      `[${tag}] 切换成功（目标店铺=${switchRes.name || "?"}），进入下一轮，当前累计已处理: ${[...processed].join(", ")}`
    );
  }

  console.log(
    `\n[${tag}] ========== 多店铺循环结束: 共 ${result.downloads.length} 家店铺 ==========`
  );
  for (const d of result.downloads) {
    const videoIcon = d.videoDays === d.daysToExport ? '✓' : '✗';
    const graphicIcon = d.graphicDays === d.daysToExport ? '✓' : '✗';
    console.log(
      `  [${d.shopName || "unknown"}] 视频 ${d.videoDays}/${d.daysToExport}天 ${videoIcon}` +
      ` | 图文 ${d.graphicDays}/${d.daysToExport}天 ${graphicIcon}` +
      (d.videoError ? ` | 视频问题: ${d.videoError}` : '') +
      (d.graphicError ? ` | 图文问题: ${d.graphicError}` : '')
    );
    if (d.failures && d.failures.length) {
      const grouped = {};
      for (const f of d.failures) {
        grouped[f.step] = (grouped[f.step] || 0) + 1;
      }
      for (const [step, count] of Object.entries(grouped)) {
        console.log(`    ⚠ 表单失败: ${step}${count > 1 ? ` (共${count}次)` : ''}`);
      }
    }
  }
  return result;
}

module.exports = {
  runPostLoginFlow,
};
