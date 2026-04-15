const smsNotifySentByAccount = new Set();
const receiveOtpNotifySentByAccount = new Set();
const faceNotifySentByAccount = new Set();
const loginStageHintByAccount = new Map();
const lastSmsConfirmClickAtByAccount = new Map();
const otpRequestSinceByAccount = new Map();
const otpLastPollAtByAccount = new Map();
const otpLastAppliedByAccount = new Map();
const otpLastStatusLogAtByAccount = new Map();
const otpLastResendAtByAccount = new Map();
const otpReceiveWaitLoggedByAccount = new Set();

module.exports = {
  smsNotifySentByAccount,
  receiveOtpNotifySentByAccount,
  faceNotifySentByAccount,
  loginStageHintByAccount,
  lastSmsConfirmClickAtByAccount,
  otpRequestSinceByAccount,
  otpLastPollAtByAccount,
  otpLastAppliedByAccount,
  otpLastStatusLogAtByAccount,
  otpLastResendAtByAccount,
  otpReceiveWaitLoggedByAccount
};

