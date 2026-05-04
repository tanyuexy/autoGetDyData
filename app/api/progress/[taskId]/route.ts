import { NextRequest } from "next/server";
import {
  drainSsePending,
  registerClient,
  unregisterClient,
  writeSseBootstrap,
} from "@/lib/sseManager";
import { killTask } from "@/lib/taskManager";

export const maxDuration = 0;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      registerClient(taskId, controller, encoder);
      writeSseBootstrap(taskId, `retry: 2000\nevent: connected\ndata: {}\n\n`);
    },
    pull() {
      drainSsePending(taskId);
    },
    cancel() {
      unregisterClient(taskId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const ok = killTask(taskId);
  return Response.json({ ok });
}
