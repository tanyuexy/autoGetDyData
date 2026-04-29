type SSEClient = {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
};

const clients = new Map<string, SSEClient>();

export function createChannel(taskId: string): {
  send: (event: string, data: any) => void;
  close: () => void;
} {
  return {
    send(event: string, data: any) {
      const client = clients.get(taskId);
      if (!client) return;
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      client.controller.enqueue(client.encoder.encode(payload));
    },
    close() {
      const client = clients.get(taskId);
      if (client) {
        try { client.controller.close(); } catch {}
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
  clients.set(taskId, { controller, encoder });
}

export function unregisterClient(taskId: string) {
  clients.delete(taskId);
}

export function getClient(taskId: string) {
  return clients.get(taskId);
}
