import {
  loadTaskLogEvents,
} from "./taskLogStore";

type SSEClient = {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
};

type BufferedEvent = { event: string; data: string };

const clients = new Map<string, SSEClient>();
const eventBuffer = new Map<string, BufferedEvent[]>();
const MAX_BUFFER_SIZE = 1000;

/** Wire-format chunks waiting for ReadableStream backpressure to clear */
const pendingSseChunks = new Map<string, string[]>();

function appendPendingChunk(taskId: string, sseChunk: string) {
  let q = pendingSseChunks.get(taskId);
  if (!q) {
    q = [];
    pendingSseChunks.set(taskId, q);
  }
  q.push(sseChunk);
}

function clearPending(taskId: string) {
  pendingSseChunks.delete(taskId);
}

/**
 * Deliver one SSE message to the browser, or queue it if the stream is backpressured.
 * Avoids dropping the client when enqueue() throws (common during large replays).
 */
function writeSseChunk(taskId: string, sseChunk: string) {
  const client = clients.get(taskId);
  if (!client) return;
  const { controller, encoder } = client;
  try {
    const ds = controller.desiredSize;
    if (ds !== null && ds <= 0) {
      appendPendingChunk(taskId, sseChunk);
      return;
    }
    controller.enqueue(encoder.encode(sseChunk));
  } catch {
    try {
      clients.delete(taskId);
    } catch {
      /* ignore */
    }
  }
}

/** Called from ReadableStream `pull` to flush queued SSE data */
export function drainSsePending(taskId: string) {
  const client = clients.get(taskId);
  if (!client) return;
  const q = pendingSseChunks.get(taskId);
  if (!q?.length) return;
  const { controller, encoder } = client;
  while (q.length > 0) {
    const chunk = q[0];
    try {
      const ds = controller.desiredSize;
      if (ds !== null && ds <= 0) return;
      controller.enqueue(encoder.encode(chunk));
      q.shift();
    } catch {
      clients.delete(taskId);
      return;
    }
  }
  pendingSseChunks.delete(taskId);
}

// ---- Public API ----

export function createChannel(taskId: string): {
  send: (event: string, data: any) => void;
  close: () => void;
} {
  return {
    send(event: string, data: any) {
      const payload = JSON.stringify(data);
      const buffer = eventBuffer.get(taskId);
      if (buffer) {
        buffer.push({ event, data: payload });
        if (buffer.length > MAX_BUFFER_SIZE) buffer.shift();
      } else {
        eventBuffer.set(taskId, [{ event, data: payload }]);
      }

      const client = clients.get(taskId);
      if (!client) {
        return;
      }
      const msg = `event: ${event}\ndata: ${payload}\n\n`;
      writeSseChunk(taskId, msg);
    },
    close() {
      clearPending(taskId);
      const client = clients.get(taskId);
      if (client) {
        try {
          client.controller.close();
        } catch {
          /* ignore */
        }
        clients.delete(taskId);
      }
    },
  };
}

export function registerClient(
  taskId: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
) {
  const prev = clients.get(taskId);
  if (prev) {
    try {
      prev.controller.close();
    } catch {
      /* ignore */
    }
  }

  clearPending(taskId);
  clients.set(taskId, { controller, encoder });

  const buffer = eventBuffer.get(taskId);
  if (buffer && buffer.length > 0) {
    for (const ev of buffer) {
      const msg = `event: ${ev.event}\ndata: ${ev.data}\n\n`;
      writeSseChunk(taskId, msg);
    }
  } else {
    const fromDisk = loadTaskLogEvents(taskId);
    if (fromDisk) {
      eventBuffer.set(taskId, fromDisk);
      for (const ev of fromDisk) {
        const msg = `event: ${ev.event}\ndata: ${ev.data}\n\n`;
        writeSseChunk(taskId, msg);
      }
    }
  }
}

/** Bootstrap line(s) after registerClient (e.g. connected event) — respects backpressure */
export function writeSseBootstrap(taskId: string, rawSseLines: string) {
  writeSseChunk(taskId, rawSseLines);
}

export function unregisterClient(taskId: string) {
  clearPending(taskId);
  clients.delete(taskId);
}

export function getClient(taskId: string) {
  return clients.get(taskId);
}

export function clearBuffer(taskId: string) {
  eventBuffer.delete(taskId);
}
