#!/usr/bin/env node

const { spawn } = require("child_process");

const children = [];
let shuttingDown = false;

function spawnNamed(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env },
    shell: process.platform === "win32",
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.log(`[dev-all] ${name} exited code=${code ?? "null"} signal=${signal || "null"}`);
    shutdown(signal || "SIGTERM", code || 0);
  });

  child.on("error", (error) => {
    if (shuttingDown) return;
    console.error(`[dev-all] ${name} failed: ${error.message || error}`);
    shutdown("SIGTERM", 1);
  });

  children.push(child);
  return child;
}

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch {}
    }
  }
  setTimeout(() => process.exit(exitCode), 300).unref?.();
}

process.once("SIGINT", () => shutdown("SIGINT", 130));
process.once("SIGTERM", () => shutdown("SIGTERM", 143));

spawnNamed("next-dev", process.execPath, [
  "./node_modules/next/dist/bin/next",
  "dev",
  "-H",
  "0.0.0.0",
]);
spawnNamed("worker-dev", process.execPath, ["--watch", "scripts/workers/task-worker.js"]);
