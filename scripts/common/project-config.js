function readProjectConfigFromEnv() {
  const raw = process.env.PROJECT_CONFIG_JSON;
  if (!raw || !String(raw).trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getProjectConfigFromEnvOrThrow() {
  const config = readProjectConfigFromEnv();
  if (!config) {
    throw new Error("缺少 PROJECT_CONFIG_JSON：请通过 scripts/run.js 启动脚本，或配置 MONGODB_URI");
  }
  return config;
}

module.exports = {
  readProjectConfigFromEnv,
  getProjectConfigFromEnvOrThrow,
};
