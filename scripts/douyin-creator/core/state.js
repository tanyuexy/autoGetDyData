const receiveOtpNotifySentByAccount = new Set();
const loginStageHintByAccount = new Map();
const otpRequestIdByAccount = new Map();
const otpRequestSinceByAccount = new Map();
const otpLastPollAtByAccount = new Map();
const otpLastAppliedByAccount = new Map();
const otpLastStatusLogAtByAccount = new Map();
const otpLastResendAtByAccount = new Map();
const otpReceiveWaitLoggedByAccount = new Set();

module.exports = {
  receiveOtpNotifySentByAccount,
  loginStageHintByAccount,
  otpRequestIdByAccount,
  otpRequestSinceByAccount,
  otpLastPollAtByAccount,
  otpLastAppliedByAccount,
  otpLastStatusLogAtByAccount,
  otpLastResendAtByAccount,
  otpReceiveWaitLoggedByAccount
};
