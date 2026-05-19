function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactStep(stepState) {
  if (!stepState || typeof stepState !== "object") return null;
  const index = Number(stepState.index);
  return {
    index: Number.isFinite(index) ? index : undefined,
    title: cleanText(stepState.title),
    tag: cleanText(stepState.tag),
    phase: cleanText(stepState.phase),
    status: cleanText(stepState.status),
    error: cleanText(stepState.error),
    url: cleanText(stepState.url),
    durationMs: Number(stepState.durationMs) || undefined,
  };
}

function classifyCreatorPublishFailure(errorText, stepState, task = {}) {
  const text = cleanText(errorText || stepState?.error || "未知错误");
  const step = compactStep(stepState);
  const haystack = cleanText(
    [
      text,
      step?.title,
      step?.tag,
      step?.phase,
      step?.error,
      step?.url,
    ].filter(Boolean).join(" ")
  );
  const publishEnabled = task?.payload?.publishEnabled !== false;
  const stepIndex = Number(step?.index || 0);
  const publishStepReached =
    publishEnabled &&
    (
      /publish/i.test(step?.tag || "") ||
      /点击发布|发布按钮|发布后/.test(step?.title || "") ||
      (stepIndex >= 9 && task?.payload?.type === "video") ||
      (stepIndex >= 10 && task?.payload?.type === "article")
    );

  if (publishStepReached) {
    return {
      category: "publish_uncertain",
      retryable: false,
      severity: "manual",
      reason: "已到达发布阶段，不能自动重试以免重复发布",
      step,
    };
  }

  if (/管理员手动终止|用户手动终止|收到 SIG(?:TERM|INT)|退出码 143|Process exited with code 143/i.test(haystack)) {
    return {
      category: "cancelled",
      retryable: false,
      severity: "cancelled",
      reason: "任务被手动终止",
      step,
    };
  }

  if (/扫码|二维码|登录态|登录失效|未登录|验证码|验证登录|请登录|cookie/i.test(haystack)) {
    return {
      category: "auth_required",
      retryable: false,
      severity: "manual",
      reason: "账号登录态或验证码需要人工处理",
      step,
    };
  }

  if (/文件不存在|缺少 --|缺少素材|missing .*file|invalid payload|无效的定时发布时间/i.test(haystack)) {
    return {
      category: "invalid_input",
      retryable: false,
      severity: "fix_data",
      reason: "任务参数或素材缺失，需要修正数据",
      step,
    };
  }

  if (/定时时间不满足平台要求|购物车限额|无法添加购物车|超出账号可挂载范围|不支持|不可使用|平台审核|审批文号|广审|商品标题未匹配|商品编辑提交失败/i.test(haystack)) {
    return {
      category: "platform_rule",
      retryable: false,
      severity: "fix_data",
      reason: "平台规则或商品资料不满足要求",
      step,
    };
  }

  if (/步骤 (?:action|verify) 超时|Timeout|timed out|net::|ERR_|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|Navigation failed|networkidle|requestfailed|Target page, context or browser has been closed/i.test(haystack)) {
    return {
      category: "transient",
      retryable: true,
      severity: "retry",
      reason: "网络、页面加载或单步超时，适合自动重试",
      step,
    };
  }

  if (/未找到|不可见|校验失败|未检测到|DOM|selector|locator|strict mode/i.test(haystack)) {
    return {
      category: "dom_or_validation",
      retryable: false,
      severity: "investigate",
      reason: "页面结构变化或结果校验失败，需要检查页面快照",
      step,
    };
  }

  return {
    category: "unknown",
    retryable: false,
    severity: "investigate",
    reason: "未知失败，保守处理为需检查",
    step,
  };
}

function formatFailureForOperator(errorText, classification) {
  const text = cleanText(errorText || "未知错误");
  const step = classification?.step;
  const stepText = step?.title
    ? `阶段${step.index || "?"}「${step.title}」${step.phase ? `/${step.phase}` : ""}`
    : "未知阶段";
  const retryText = classification?.retryable ? "可自动重试" : "不建议自动重试";
  return `${stepText}失败：${text}；分类=${classification?.category || "unknown"}，${retryText}，原因=${classification?.reason || "未分类"}`;
}

module.exports = {
  classifyCreatorPublishFailure,
  formatFailureForOperator,
};
