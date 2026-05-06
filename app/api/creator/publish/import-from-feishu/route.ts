import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { spawnTask, generateTaskIdWithTime, canStartTask } from "@/lib/taskManager";
import { runPendingCreatorPublishTasks } from "@/lib/creatorPublishScheduler";
import {
  readCreatorPublishTasks,
  writeCreatorPublishTasks,
  type CreatorPublishTask,
} from "@/lib/creatorPublishStore";

const IMPORTED_TASKS_PATH = path.resolve(
  process.cwd(),
  "storage/creator-publish/.imported-tasks.json"
);

function mergeImportedTasks() {
  try {
    if (!fs.existsSync(IMPORTED_TASKS_PATH)) return;
    const raw = fs.readFileSync(IMPORTED_TASKS_PATH, "utf-8");
    const imported: CreatorPublishTask[] = JSON.parse(raw);
    if (!Array.isArray(imported) || imported.length === 0) return;

    const existing = readCreatorPublishTasks();
    const existingIds = new Set(existing.map((t) => t.id));

    for (const task of imported) {
      if (!existingIds.has(task.id)) {
        existing.unshift(task);
      }
    }

    writeCreatorPublishTasks(existing);

    try { fs.unlinkSync(IMPORTED_TASKS_PATH); } catch {}
  } catch (e) {
    console.error("[import-from-feishu] 合并导入任务失败:", e);
  }
}

export const maxDuration = 0;

export async function POST(_request: NextRequest) {
  try {
    if (!canStartTask("creator-publish")) {
      return NextResponse.json(
        { error: "已有发布任务正在执行，请等待完成后再导入" },
        { status: 409 }
      );
    }

    require("dotenv").config();

    const taskId = generateTaskIdWithTime("feishu-import");
    spawnTask(taskId, "node", [
      "scripts/run.js",
      "feishu:import-publish-tasks",
    ], {
      namespace: "creator-publish",
      onClose: () => {
        mergeImportedTasks();
        runPendingCreatorPublishTasks();
      },
      onError: () => {
        mergeImportedTasks();
        runPendingCreatorPublishTasks();
      },
    });

    return NextResponse.json({ taskId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
