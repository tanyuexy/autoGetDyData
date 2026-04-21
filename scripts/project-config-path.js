const path = require("path");

/**
 * 主项目配置 JSON 的绝对路径。
 * 优先环境变量 PROJECT_CONFIG_PATH 或 ADD_ACCOUNTS_JSON（兼容旧名）。
 * 默认：仓库根目录下的 config.json。
 */
function getProjectConfigPath() {
  const fromEnv =
    process.env.PROJECT_CONFIG_PATH || process.env.ADD_ACCOUNTS_JSON;
  if (fromEnv && String(fromEnv).trim()) {
    const s = String(fromEnv).trim();
    return path.isAbsolute(s) ? s : path.resolve(process.cwd(), s);
  }
  return path.resolve(process.cwd(), "config.json");
}

module.exports = { getProjectConfigPath };
