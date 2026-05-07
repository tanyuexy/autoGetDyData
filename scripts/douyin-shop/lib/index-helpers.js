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

function printResultSummary(results) {
  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n完成: 成功 ${okCount} / ${results.length}`);

  console.log(`\n最终结果明细:`);
  for (const item of results) {
    if (!item.ok) {
      console.log(`  [${item.account}] 登录失败: ${item.error}`);
      continue;
    }
    const downloads = Array.isArray(item.downloads) ? item.downloads : [];
    if (downloads.length === 0) {
      console.log(`  [${item.account}] 无数据导出`);
      continue;
    }
    for (const d of downloads) {
      const name = d.shopName || "未知店铺";
      const videoIcon = d.videoDays === d.daysToExport ? '✓' : '✗';
      const graphicIcon = d.graphicDays === d.daysToExport ? '✓' : '✗';
      const status = d.videoPath && d.graphicPath ? '全部完成' :
        d.videoPath ? '仅视频完成' :
          d.graphicPath ? '仅图文完成' : '全部失败';
      console.log(
        `  ✓ [${item.account}] ${name}` +
        ` | 视频 ${d.videoDays || 0}/${d.daysToExport || 1}天 ${videoIcon}` +
        ` | 图文 ${d.graphicDays || 0}/${d.daysToExport || 1}天 ${graphicIcon}` +
        ` | ${status}`
      );
      if (d.videoError) console.log(`      视频错误: ${d.videoError}`);
      if (d.graphicError) console.log(`      图文错误: ${d.graphicError}`);
      if (d.videoPath) console.log(`      视频文件: ${d.videoPath}`);
      if (d.graphicPath) console.log(`      图文文件: ${d.graphicPath}`);
      const vdm = Array.isArray(d.videoDateMismatches) ? d.videoDateMismatches : [];
      const gdm = Array.isArray(d.graphicDateMismatches) ? d.graphicDateMismatches : [];
      if (vdm.length) console.log(`      ⚠ 视频日期不符（日历选中≠预期）: ${vdm.join(', ')}`);
      if (gdm.length) console.log(`      ⚠ 图文日期不符（日历选中≠预期）: ${gdm.join(', ')}`);
      if (d.failures && d.failures.length) {
        const grouped = {};
        for (const f of d.failures) {
          grouped[f.step] = (grouped[f.step] || 0) + 1;
        }
        console.log(`      ⚠ 表单操作失败详情:`);
        for (const [step, count] of Object.entries(grouped)) {
          console.log(`          - ${step}${count > 1 ? ` (共${count}次)` : ''}`);
        }
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log("失败账号:");
    for (const item of failed) {
      console.log(`- ${item.account}: ${item.error}`);
    }
    process.exitCode = 1;
  }
}

module.exports = {
  collectProcessedNamesIntoSet,
  buildRemainingTargetsResolver,
  printResultSummary,
};
