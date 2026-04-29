import { NextRequest } from "next/server";
import { registerClient, unregisterClient } from "@/lib/sseManager";
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
      const payload = `event: connected\ndata: {}\n\n`;
      controller.enqueue(encoder.encode(payload));
    },
    cancel() {
      unregisterClient(taskId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
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
