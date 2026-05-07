function printAccountExecutionSummary(results) {
  const successCount = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok);

  console.log(`\n全部执行完成: 成功 ${successCount} / ${results.length}`);
  if (failed.length > 0) {
    console.log("失败账号:");
    for (const item of failed) {
      console.log(`- ${item.accountName}: ${item.error}`);
    }
    process.exitCode = 1;
  }

  return {
    successCount,
    failed,
    allSuccess: results.length > 0 && successCount === results.length
  };
}

function printExportChannelSummary(withAuth, withoutAuth, loginVerifyMethod) {
  console.log(`导出通道A(已有登录态): ${withAuth.length} 个账号`);
  console.log(`导出通道B(需登录验证): ${withoutAuth.length} 个账号`);
  console.log(
    `登录验证方式: ${
      loginVerifyMethod === "sms"
        ? "发送短信验证"
        : loginVerifyMethod === "receive_sms_code"
          ? "接收短信验证码(邮件回填)"
          : "二维码/默认流程"
    }`
  );
}

module.exports = {
  printAccountExecutionSummary,
  printExportChannelSummary,
};
