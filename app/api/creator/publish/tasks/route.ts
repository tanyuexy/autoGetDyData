import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  patchCreatorPublishTask,
  readCreatorPublishTasks,
  reconcileStaleRunningCreatorPublishTasks,
  writeCreatorPublishTasks,
  type CreatorPublishPayload,
  type CreatorPublishTask,
} from "@/lib/creatorPublishStore";
import { runPendingCreatorPublishTasks } from "@/lib/creatorPublishScheduler";

export const maxDuration = 0;

export async function GET() {
  reconcileStaleRunningCreatorPublishTasks();
  const tasks = readCreatorPublishTasks();
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const accountName = String(body.accountName || "").trim();
    if (!accountName) {
      return NextResponse.json({ error: "missing accountName" }, { status: 400 });
    }

    const payload = body.payload as CreatorPublishPayload;
    if (!payload || (payload.type !== "video" && payload.type !== "article")) {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }

    if (payload.type === "video") {
      if (!payload.videoFileKey) {
        return NextResponse.json({ error: "missing videoFileKey" }, { status: 400 });
      }
    } else {
      if (!Array.isArray(payload.imagesFileKeys) || payload.imagesFileKeys.length === 0) {
        return NextResponse.json({ error: "missing imagesFileKeys" }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const id = crypto.randomBytes(8).toString("hex");

    const task: CreatorPublishTask = {
      id,
      createdAt: now,
      updatedAt: now,
      accountName,
      status: "pending",
      payload: {
        ...payload,
        scheduleAt: payload.scheduleAt || null,
      },
    };

    const tasks = readCreatorPublishTasks();
    tasks.unshift(task);
    writeCreatorPublishTasks(tasks);

    return NextResponse.json({ ok: true, task });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || "").trim();
    const id = String(body.id || "").trim();

    if (action === "kill-all") {
      const tasks = readCreatorPublishTasks();
      let killed = 0;
      for (const task of tasks) {
        if (task.status !== "running") continue;
        if (task.taskId) {
          const { killTask } = require("@/lib/taskManager");
          await killTask(task.taskId);
        }
        task.status = "cancelled";
        task.updatedAt = new Date().toISOString();
        task.lastError = "用户手动终止";
        killed++;
      }
      writeCreatorPublishTasks(tasks);
      return NextResponse.json({ ok: true, killed });
    }

    if (action === "kill-bulk") {
      const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
      if (ids.length === 0) {
        return NextResponse.json({ error: "missing ids" }, { status: 400 });
      }

      let killed = 0;
      const tasks = readCreatorPublishTasks();
      for (const task of tasks) {
        if (!ids.includes(task.id)) continue;
        if (task.status !== "pending" && task.status !== "running") continue;
        if (task.status === "running" && task.taskId) {
          const { killTask } = require("@/lib/taskManager");
          await killTask(task.taskId);
        }
        task.status = "cancelled";
        task.updatedAt = new Date().toISOString();
        task.lastError = "用户手动终止";
        killed++;
      }
      writeCreatorPublishTasks(tasks);
      return NextResponse.json({ ok: true, killed });
    }

    if (action === "start-bulk") {
      const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
      if (ids.length === 0) {
        return NextResponse.json({ error: "missing ids" }, { status: 400 });
      }

      let started = 0;
      const tasks = readCreatorPublishTasks();
      for (const t of tasks) {
        if (!ids.includes(t.id)) continue;
        t.status = "queued";
        t.updatedAt = new Date().toISOString();
        started++;
      }
      writeCreatorPublishTasks(tasks);

      if (started > 0) {
        runPendingCreatorPublishTasks();
      }

      return NextResponse.json({ ok: true, started });
    }

    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

    if (action === "run-now") {
      const existing = readCreatorPublishTasks().find((t) => t.id === id);
      if (!existing) return NextResponse.json({ error: "task not found" }, { status: 404 });
      if (existing.status !== "pending" && existing.status !== "queued") {
        return NextResponse.json({ error: "只能立即执行待执行的任务" }, { status: 400 });
      }

      const next = patchCreatorPublishTask(id, {
        status: "queued",
        payload: { ...existing.payload, scheduleAt: null },
      });
      runPendingCreatorPublishTasks();

      return NextResponse.json({ ok: true, task: next });
    }

    if (action === "retry") {
      const existing = readCreatorPublishTasks().find((t) => t.id === id);
      if (!existing) return NextResponse.json({ error: "task not found" }, { status: 404 });

      const next = patchCreatorPublishTask(id, {
        status: "queued",
        lastError: undefined,
        taskId: undefined,
      });
      runPendingCreatorPublishTasks();

      return NextResponse.json({ ok: true, task: next });
    }

    if (action === "delete") {
      const tasks = readCreatorPublishTasks();
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx < 0) return NextResponse.json({ error: "task not found" }, { status: 404 });

      const task = tasks[idx];
      if (task.status === "running" && task.taskId) {
        const { killTask } = require("@/lib/taskManager");
        await killTask(task.taskId);
      }

      tasks.splice(idx, 1);
      writeCreatorPublishTasks(tasks);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
