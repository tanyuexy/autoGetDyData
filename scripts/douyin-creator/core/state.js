const receiveOtpNotifySentByAccount = new Set();
const loginStageHintByAccount = new Map();
const otpRequestIdByAccount = new Map();
const otpRequestSinceByAccount = new Map();
const otpLastPollAtByAccount = new Map();
const otpLastAppliedByAccount = new Map();
const otpLastStatusLogAtByAccount = new Map();
const otpLastResendAtByAccount = new Map();
const otpReceiveWaitLoggedByAccount = new Set();
/** 等待登录循环中首次看到 QR 的时间（按账号） */
const loginQrFirstSeenAtByAccount = new Map();
/** 最近一次成功推送的登录 QR 图片指纹（按账号，避免重复推过期图） */
const lastPushedLoginQrFingerprintByAccount = new Map();

module.exports = {
  receiveOtpNotifySentByAccount,
  loginStageHintByAccount,
  otpRequestIdByAccount,
  otpRequestSinceByAccount,
  otpLastPollAtByAccount,
  otpLastAppliedByAccount,
  otpLastStatusLogAtByAccount,
  otpLastResendAtByAccount,
  otpReceiveWaitLoggedByAccount,
  loginQrFirstSeenAtByAccount,
  lastPushedLoginQrFingerprintByAccount
};
