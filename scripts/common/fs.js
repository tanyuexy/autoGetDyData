const fs = require("fs/promises");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeFileName(name) {
  return String(name || "").trim().replace(/[\\/:*?"<>|]/g, "_");
}

module.exports = {
  ensureDir,
  fileExists,
  normalizeFileName,
};
