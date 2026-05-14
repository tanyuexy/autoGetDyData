require("tsx/cjs/api").register();

const path = require("path");
const {
  CREATOR_KEY_COOKIE_PATTERNS,
  analyzeStorageState,
  mergeVerificationIntoAnalysis,
  readLastVerified
} = require(path.join(__dirname, "../../../lib/cookie-checker.ts"));
const { getAccountPaths } = require("./accounts");

const ANALYSIS_MAX_AGE_DAYS = 14;

/**
 * 与配置页抖创账号表里「登录态」列同源
 * @param {string} accountName
 * @returns {{ cookieStatus: string, cookieDetail: string | null }}
 */
function getEffectiveCreatorCookieStatus(accountName) {
  const paths = getAccountPaths(accountName);
  const analysis = analyzeStorageState(
    paths.storageStatePath,
    CREATOR_KEY_COOKIE_PATTERNS,
    ANALYSIS_MAX_AGE_DAYS
  );
  const lastVerified = readLastVerified(paths.accountDir);
  return mergeVerificationIntoAnalysis(analysis, lastVerified);
}

/**
 * 「有效」走 storageState；其余走强制登录队列。
 * @param {string[]} accountNames
 * @returns {{ withAuth: string[], withoutAuth: string[] }}
 */
function splitAccountsByCreatorSettingsStatus(accountNames) {
  const withAuth = [];
  const withoutAuth = [];
  for (const accountName of accountNames) {
    const { cookieStatus } = getEffectiveCreatorCookieStatus(accountName);
    if (cookieStatus === "valid" || cookieStatus === "warning") {
      withAuth.push(accountName);
    } else {
      withoutAuth.push(accountName);
    }
  }
  return { withAuth, withoutAuth };
}

module.exports = {
  getEffectiveCreatorCookieStatus,
  splitAccountsByCreatorSettingsStatus
};
