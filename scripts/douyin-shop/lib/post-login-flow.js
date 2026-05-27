const fse = require("fs-extra");
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
const { saveDebugArtifacts } = require("./debug");
const { logMilestone, logWarn, logError } = require("./shop-log");

function buildShopExportIncompleteError(round, shopTag) {
  const parts = [
    `视频 ${round.videoDays}/${round.videoTargetCount}天`,
    `图文 ${round.graphicDays}/${round.graphicTargetCount}天`
  ];
  if (round.videoDateMismatches?.length) {
    parts.push(`视频日期失败: ${round.videoDateMismatches.join(", ")}`);
  }
  if (round.graphicDateMismatches?.length) {
    parts.push(`图文日期失败: ${round.graphicDateMismatches.join(", ")}`);
  }
  if (round.videoError) parts.push(`视频错误: ${round.videoError}`);
  if (round.graphicError) parts.push(`图文错误: ${round.graphicError}`);
  if (round.failures?.length) {
    const grouped = {};
    for (const f of round.failures) grouped[f.step] = (grouped[f.step] || 0) + 1;
    parts.push(
      `步骤失败: ${Object.entries(grouped)
        .map(([step, n]) => (n > 1 ? `${step}(${n}次)` : step))
        .join(", ")}`
    );
  }
  return new Error(`[${shopTag}] 店铺导出不完整，终止任务：${parts.join("；")}`);
}

async function saveStorageState(context, paths) {
  await context.storageState({ path: paths.storageStatePath });
  try {
    const state = JSON.parse(
      await fse.readFile(paths.storageStatePath, "utf-8")
    );
    await fse.writeFile(
      paths.cookiesPath,
      JSON.stringify(state.cookies || [], null, 2),
      "utf-8"
    );
  } catch {
  }
}

/**
 * 下载当前店铺的短视频明细 + 图文明细；二者独立 try/catch，互不影响。
 * 店铺名只使用上游传入的目标店铺名。
 */
async function downloadCurrentShop(page, tag, paths, options = {}) {
  const shopName = String(options.shopNameHint || "").trim();
  if (!shopName) {
    logWarn(`[${tag}] 缺少上游目标店铺名，将以 "unknown" 归档`);
  }

  const shopTag = shopName ? `${tag}|${shopName}` : tag;
  const sn = shopName || "unknown";
  const daysToExport = options.daysToExport || 1;
  const exportBatchId = options.exportBatchId || null;
  const accountEmail = options.accountEmail || "";
  const targetDates = Array.isArray(options.targetDates) ? options.targetDates : null;
  const targetKinds = Array.isArray(options.targetKinds) ? options.targetKinds : null;
  const stepRunner = options.stepRunner || null;
  const stepIndexBase = Number(options.stepIndexBase || 100);
  const debugOptions = options.debugOptions || {};

  let videoPaths = [];
  let graphicPaths = [];
  let videoError;
  let graphicError;
  let videoDateMismatches = [];
  let graphicDateMismatches = [];
  let videoTargetCount = targetKinds && !targetKinds.includes("video") ? 0 : daysToExport;
  let graphicTargetCount = targetKinds && !targetKinds.includes("graphic") ? 0 : daysToExport;
  let videoCompleteDays = 0;
  const allFailures = [];

  try {
    const result = await downloadVideoSelfDetail(page, {
      tag: shopTag,
      saveDir: paths.dataDir,
      shopName: sn,
      daysToExport,
      exportBatchId,
      accountEmail,
      targetDates,
      targetKinds,
      stepRunner,
      stepIndexBase: stepIndexBase + 10,
      shopIndex: options.shopIndex,
      shopTotal: options.shopTotal
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
      videoTargetCount = result.targetCount ?? daysToExport;
      videoCompleteDays = result.completeDays ?? 0;
    } else if (result.savePath) {
      videoPaths = [result.savePath];
      videoCompleteDays = 1;
    }
  } catch (error) {
    videoError = error?.message || String(error);
    logError(`[${shopTag}] 视频明细下载失败: ${videoError}`);
    await saveDebugArtifacts(
      page,
      accountEmail || tag,
      `download-video-failed-${stepIndexBase}`,
      debugOptions
    ).catch(() => {});
  }

  try {
    const result = await downloadGraphicDetail(page, {
      tag: shopTag,
      saveDir: paths.dataDir,
      shopName: sn,
      daysToExport,
      exportBatchId,
      accountEmail,
      targetDates,
      targetKinds,
      stepRunner,
      stepIndexBase: stepIndexBase + 50,
      shopIndex: options.shopIndex,
      shopTotal: options.shopTotal
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
      graphicTargetCount = result.targetCount ?? daysToExport;
    } else if (result.savePath) {
      graphicPaths = [result.savePath];
    }
  } catch (error) {
    graphicError = error?.message || String(error);
    logError(`[${shopTag}] 图文明细下载失败: ${graphicError}`);
    await saveDebugArtifacts(
      page,
      accountEmail || tag,
      `download-graphic-failed-${stepIndexBase}`,
      debugOptions
    ).catch(() => {});
  }

  const ok =
    videoCompleteDays === videoTargetCount &&
    graphicPaths.length === graphicTargetCount;
  const parts = [videoError, graphicError].filter(Boolean);

  const videoDaysOk = videoError ? 0 : videoCompleteDays;
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

  logMilestone(
    shopTag,
    `导出汇总 视频 ${videoDaysOk}/${videoTargetCount}天(非投放+投放) ${videoDaysOk === videoTargetCount ? "✓" : "✗"} | 图文 ${graphicDaysOk}/${graphicTargetCount}天 ${graphicDaysOk === graphicTargetCount ? "✓" : "✗"}` +
    (!dateOk ? ` | ⚠ ${dateMismatchWarn.join("; ")}` : "") +
    (videoError ? ` | 视频错误: ${videoError}` : "") +
    (graphicError ? ` | 图文错误: ${graphicError}` : "") +
    (failedStepsDetail.length ? ` | 表单失败: ${failedStepsDetail.join(", ")}` : "")
  );

  return {
    ok,
    shopName,
    videoDays: videoDaysOk,
    graphicDays: graphicDaysOk,
    daysToExport,
    videoTargetCount,
    graphicTargetCount,
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
 * 1) 若出现「请选择店铺」页，按 Mongo app_config accounts 选中第一个匹配项并等待落地稳定
 * 2) 若无选店页（cookie 等），必要时通过「切换数据视角」切到名单中的第一家
 * 3) 每店依次下载短视频明细与图文分析明细，再切到下一个未处理名单店铺重复
 *
 * 每一步都尽量独立捕获异常，避免因后置步骤失败而否定登录动作本身的成果。
 */
async function runPostLoginFlow(page, tag, paths, options = {}) {
  const stepRunner = options.stepRunner || null;
  const runStep = stepRunner?.runStep;
  const withStep = async (index, title, stepTag, action, verifyOrOptions, maybeOptions) => {
    if (typeof runStep === "function") {
      return await runStep(index, title, stepTag, action, verifyOrOptions, maybeOptions);
    }
    if (typeof action === "function") await action();
    const verify = verifyOrOptions && typeof verifyOrOptions === "object"
      ? verifyOrOptions.verify
      : verifyOrOptions;
    if (typeof verify === "function") await verify();
  };

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
  logMilestone(
    tag,
    `待处理 ${preferredList.length}/${fullPreferredList.length} 店${preferredList.length ? ": " + preferredList.slice(0, 5).join(", ") + (preferredList.length > 5 ? " ..." : "") : ""}`
  );

  if (preferredList.length === 0) {
    logMilestone(tag, "本账号无新店铺，跳过");
    return result;
  }

  let entryStage = null;
  await withStep(
    10,
    "识别登录后页面阶段",
    "post-login-detect-stage",
    async () => {
      entryStage = await detectStage(page);
    },
    {
      verify: async () => {
        if (!entryStage?.stage) throw new Error("未能识别登录后页面阶段");
      },
      meta: { phase: "prepare", targetShopCount: preferredList.length }
    }
  );


  if (entryStage.stage === STAGES.LOGIN_FORM || entryStage.stage === STAGES.CAPTCHA) {
    logWarn(`[${tag}] post-login 入口仍是 ${entryStage.stage}，终止下载`);
    return result;
  }

  if (entryStage.stage === STAGES.SHOP_PICKER) {
    try {
      let pick = null;
      await withStep(
        11,
        "选择目标店铺",
        "select-shop-from-picker",
        async () => {
          pick = await selectShopIfPicker(page, { tag, preferredList });
        },
        {
          verify: async () => {
            if (!pick?.picked) throw new Error("选店页未选中目标店铺");
          },
          meta: { phase: "prepare", targetShopCount: preferredList.length }
        }
      );
      if (pick.picked) {
        result.shopPicked = true;
        result.shopName = pick.name;
      } else {
        result.shopPicked = false;
      }
    } catch (error) {
      logWarn(`[${tag}] 店铺选择阶段异常: ${error.message || error}`);
      result.shopPicked = false;
    }
  } else {

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
    let sw = null;
    await withStep(
      12,
      "切换到第一个目标店铺",
      "switch-first-shop",
      async () => {
        sw = await switchToNextPreferredShop(page, {
          tag,
          processedNames: processed,
          preferredList
        });
      },
      {
        verify: async () => {
          if (!sw?.switched && sw?.reason !== "no-match") {
            throw new Error(`未能切换到第一个目标店铺: ${sw?.reason || "unknown"}`);
          }
        },
        meta: { phase: "prepare", targetShopCount: preferredList.length }
      }
    );
    if (!sw.switched && sw.reason === "no-match") {
      logMilestone(tag, "本账号未命中优先级名单，跳过下载");
      return result;
    }
    if (sw.switched) {
      pendingShopHint = sw.name || null;
      result.shopName = result.shopName || sw.name || null;
    }
  }

  await withStep(
    13,
    "等待店铺页面稳定",
    "wait-shop-dom-loaded",
    async () => {
      await waitForDomLoaded(page, { tag });
    },
    {
      meta: { shopName: pendingShopHint || result.shopName || null, phase: "prepare" }
    }
  );

  try {
    await withStep(
      14,
      "预热短视频明细页",
      "preopen-video-page",
      async () => {
        await gotoVideoSelf(page, tag);
      },
      {
        meta: { shopName: pendingShopHint || result.shopName || null, phase: "prepare" }
      }
    );
  } catch (error) {
    logWarn(`[${tag}] 预热短视频页失败（下载流程内重试）: ${error.message || error}`);
  }

  const maxShops = preferredList.length > 0 ? preferredList.length : 1;

  for (let i = 0; i < maxShops; i += 1) {
    const daysToExport = options.daysToExport || 1;
    const currentTarget = pendingShopHint || "unknown";
    logMilestone(tag, `[${i + 1}/${maxShops}] ${currentTarget} | ${daysToExport}天`);
    const round = await downloadCurrentShop(page, tag, paths, {
      shopNameHint: pendingShopHint,
      daysToExport,
      exportBatchId: options.exportBatchId || null,
      accountEmail: options.accountEmail || "",
      targetDates: options.targetDates || null,
      targetKinds: options.targetKinds || null,
      stepRunner,
      debugOptions: options.debugOptions || stepRunner?.debugOptions || {},
      stepIndexBase: 1000 + i * 100,
      shopIndex: i + 1,
      shopTotal: maxShops
    });
    if (round.shopName) {
      processed.add(round.shopName);
      if (!result.shopName) result.shopName = round.shopName;
    }

    if (round.shopName && preferredList.length > 0 && !isPreferredShop(round.shopName)) {
      logWarn(`[${tag}] 店铺 "${round.shopName}" 不在优先级名单内，结束`);
      break;
    }

    if (!round.ok) {
      const shopTag = round.shopName ? `${tag}|${round.shopName}` : tag;
      throw buildShopExportIncompleteError(round, shopTag);
    }

    result.downloads.push({
      shopName: round.shopName,
      videoPath: round.videoPath,
      graphicPath: round.graphicPath,
      videoDays: round.videoDays,
      graphicDays: round.graphicDays,
      daysToExport: round.daysToExport,
      videoTargetCount: round.videoTargetCount,
      graphicTargetCount: round.graphicTargetCount,
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

    if (preferredList.length === 0) {
      logMilestone(tag, "未配置优先级名单，结束循环");
      break;
    }

    let switchRes;
    try {
      await withStep(
        8000 + i,
        "切换到下一个目标店铺",
        `switch-next-shop-${i + 1}`,
        async () => {
          switchRes = await switchToNextPreferredShop(page, {
            tag,
            processedNames: processed,
            preferredList
          });
        },
        {
          verify: async () => {
            if (!switchRes) throw new Error("未返回切店结果");
          },
          meta: {
            phase: "switch",
            shopIndex: i + 1,
            shopTotal: maxShops,
            processedShopCount: processed.size
          }
        }
      );
    } catch (error) {
      logWarn(`[${tag}] 切换店铺阶段异常: ${error.message || error}`);
      await saveDebugArtifacts(
        page,
        options.accountEmail || tag,
        `switch-shop-failed-${i + 1}`,
        options.debugOptions || stepRunner?.debugOptions || {}
      ).catch(() => {});
      break;
    }

    if (!switchRes.switched) {
      if (switchRes.reason === "no-match") {
        logMilestone(tag, `无更多待切店铺，结束（已处理 ${processed.size} 家）`);
      } else if (switchRes.reason === "modal-not-opened") {
        logWarn(`[${tag}] 无「切换数据视角」入口，结束循环`);
        await saveDebugArtifacts(
          page,
          options.accountEmail || tag,
          `switch-entry-missing-${i + 1}`,
          options.debugOptions || stepRunner?.debugOptions || {}
        ).catch(() => {});
      } else {
        logWarn(`[${tag}] 切店失败 (${switchRes.reason || "unknown"})，结束循环`);
      }
      break;
    }

    pendingShopHint = switchRes.name || null;

  }

  logMilestone(tag, `多店铺完成: ${result.downloads.length} 家`);
  return result;
}

module.exports = {
  runPostLoginFlow,
};
