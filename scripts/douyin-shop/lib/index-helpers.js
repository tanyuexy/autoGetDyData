function collectProcessedNamesIntoSet(result, processedNames) {
  if (!(processedNames instanceof Set) || !result) return;
  if (result.processedNames instanceof Set) {
    for (const n of result.processedNames) processedNames.add(n);
  }
  if (Array.isArray(result.downloads)) {
    for (const d of result.downloads) {
      if (d && d.shopName) processedNames.add(d.shopName);
    }
  }
}

function buildRemainingTargetsResolver(preferredList, processedNames) {
  const totalTargets = preferredList.length;
  return function remainingTargets() {
    if (totalTargets === 0) return [];
    return preferredList.filter((name) => {
      for (const done of processedNames) {
        if (!done) continue;
        if (done === name) return false;
        if (name.includes(done) || done.includes(name)) return false;
      }
      return true;
    });
  };
}

const { logInfo, logWarn } = require("./shop-log");

function printResultSummary(results) {
  const okCount = results.filter((r) => r.ok).length;
  logInfo(`完成: 成功 ${okCount} / ${results.length}`);

  for (const item of results) {
    if (!item.ok) {
      logWarn(`[${item.account}] 登录失败: ${item.error}`);
      continue;
    }
    const downloads = Array.isArray(item.downloads) ? item.downloads : [];
    if (downloads.length === 0) {
      logWarn(`[${item.account}] 无数据导出`);
      continue;
    }
    for (const d of downloads) {
      const name = d.shopName || "未知店铺";
      const videoIcon = d.videoDays === d.daysToExport ? "✓" : "✗";
      const graphicIcon = d.graphicDays === d.daysToExport ? "✓" : "✗";
      const extras = [];
      if (d.videoError) extras.push(`视频: ${d.videoError}`);
      if (d.graphicError) extras.push(`图文: ${d.graphicError}`);
      const vdm = Array.isArray(d.videoDateMismatches) ? d.videoDateMismatches : [];
      const gdm = Array.isArray(d.graphicDateMismatches) ? d.graphicDateMismatches : [];
      if (vdm.length) extras.push(`视频日期不符: ${vdm.join(", ")}`);
      if (gdm.length) extras.push(`图文日期不符: ${gdm.join(", ")}`);
      if (d.failures && d.failures.length) {
        const grouped = {};
        for (const f of d.failures) grouped[f.step] = (grouped[f.step] || 0) + 1;
        const parts = Object.entries(grouped).map(([step, count]) =>
          count > 1 ? `${step}(${count}次)` : step
        );
        extras.push(`表单失败: ${parts.join(", ")}`);
      }
      const tail = extras.length ? ` | ${extras.join("; ")}` : "";
      logInfo(
        `  ✓ [${item.account}] ${name} | 视频 ${d.videoDays || 0}/${d.daysToExport || 1}天 ${videoIcon} | 图文 ${d.graphicDays || 0}/${d.daysToExport || 1}天 ${graphicIcon}${tail}`
      );
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    for (const item of failed) {
      logWarn(`失败账号: ${item.account}: ${item.error}`);
    }
    process.exitCode = 1;
  }
}

module.exports = {
  collectProcessedNamesIntoSet,
  buildRemainingTargetsResolver,
  printResultSummary,
};
