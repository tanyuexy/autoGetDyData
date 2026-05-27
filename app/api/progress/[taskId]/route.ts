import { NextRequest } from "next/server";
import { killTask } from "@/lib/tasks/taskManager";
import { loadTaskLogEvents } from "@/lib/tasks/taskLogStore";

export const maxDuration = 0;

const POLL_MS = 500;

function writeSse(controller: ReadableStreamDefaultController, encoder: TextEncoder, chunk: string) {
  controller.enqueue(encoder.encode(chunk));
}

function formatSse(event: string, data: string) {
  return `event: ${event}\ndata: ${data}\n\n`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const closeStream = (controller?: ReadableStreamDefaultController) => {
    closed = true;
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (controller) {
      try {
        controller.close();
      } catch {
        // Stream may already be closed by the browser.
      }
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      let sentCount = 0;

      writeSse(controller, encoder, `retry: 2000\nevent: connected\ndata: {}\n\n`);

      const flush = () => {
        if (closed) return;
        try {
          const events = loadTaskLogEvents(taskId) || [];
          if (events.length < sentCount) sentCount = 0;

          for (const ev of events.slice(sentCount)) {
            writeSse(controller, encoder, formatSse(ev.event, ev.data));
            if (ev.event === "done") {
              closeStream(controller);
              return;
            }
          }
          sentCount = events.length;
        } catch {
          closeStream();
        }
      };

      interval = setInterval(flush, POLL_MS);
      flush();
    },
    cancel() {
      closeStream();
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
  const ok = await killTask(taskId);
  return Response.json({ ok });
}
