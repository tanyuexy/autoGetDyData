import { spawn, ChildProcess } from "child_process";
import { createChannel } from "./sseManager";
import { getConfig } from "./configService";

const tasks = new Map<string, ChildProcess>();
let runningTaskId: string | null = null;

export function isTaskRunning(): boolean {
  return runningTaskId !== null;
}

export function getRunningTaskId(): string | null {
  return runningTaskId;
}

export function spawnTask(
  taskId: string,
  command: string,
  args: string[],
  options?: { cwd?: string }
): { sse: ReturnType<typeof createChannel>; child: ChildProcess } {
  if (runningTaskId) {
    throw new Error(`Task ${runningTaskId} is already running`);
  }

  const sse = createChannel(taskId);
  runningTaskId = taskId;

  // Read config to pass HEADLESS to child process
  let headless = String(process.env.HEADLESS === "true" || process.env.HEADLESS === "1");
  try {
    const cfg = getConfig();
    headless = String(cfg.headless === true);
  } catch {}

  const child = spawn(command, args, {
    cwd: options?.cwd || process.cwd(),
    env: { ...process.env, HEADLESS: headless },
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });

  tasks.set(taskId, child);

  let stdoutBuf = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      sse.send("log", { text: trimmed, level: "info", timestamp: new Date().toISOString() });
    }
  });

  let stderrBuf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      sse.send("log", { text: trimmed, level: "error", timestamp: new Date().toISOString() });
    }
  });

  child.on("close", (code) => {
    // Flush remaining buffers
    if (stdoutBuf.trim()) {
      sse.send("log", { text: stdoutBuf.trimEnd(), level: "info", timestamp: new Date().toISOString() });
    }
    if (stderrBuf.trim()) {
      sse.send("log", { text: stderrBuf.trimEnd(), level: "error", timestamp: new Date().toISOString() });
    }
    sse.send("done", { code: code ?? -1, summary: `Process exited with code ${code ?? -1}` });
    sse.close();
    tasks.delete(taskId);
    runningTaskId = null;
  });

  child.on("error", (err) => {
    sse.send("log", { text: `Process error: ${err.message}`, level: "error", timestamp: new Date().toISOString() });
    sse.send("done", { code: -1, summary: err.message });
    sse.close();
    tasks.delete(taskId);
    runningTaskId = null;
  });

  return { sse, child };
}

export function killTask(taskId: string): boolean {
  const child = tasks.get(taskId);
  if (!child) return false;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 5000);
  return true;
}

export function getTaskList(): string[] {
  return Array.from(tasks.keys());
}
