import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { DeviceRegistry } from './device-registry.js';
import { isRecord, parseMessage, type RegisterMessage, type ResultMessage } from '@open-remote-desktop-mcp/protocol';

export function createDeviceWebSocketServer(httpServer: HttpServer, registry: DeviceRegistry): WebSocketServer {
  const server = new WebSocketServer({ server: httpServer, path: '/device' });
  server.on('connection', (socket) => handleConnection(socket, registry));
  return server;
}

function handleConnection(socket: WebSocket, registry: DeviceRegistry): void {
  let deviceId: string | undefined;
  let registered = false;

  const registrationTimeout = setTimeout(() => {
    if (!registered) socket.close(1008, 'Registration required');
  }, 10_000);

  socket.on('message', (raw) => {
    try {
      const message = parseMessage(JSON.parse(raw.toString()));
      if (!message) throw new Error('Invalid message');

      if (!registered) {
        if (message.type !== 'register') throw new Error('First message must be register');
        registry.register(message as unknown as RegisterMessage, socket);
        deviceId = (message as { deviceId: string }).deviceId;
        registered = true;
        clearTimeout(registrationTimeout);
        socket.send(JSON.stringify({ type: 'registered', protocolVersion: 1, deviceId }));
        return;
      }

      if (message.type === 'heartbeat') {
        registry.heartbeat(deviceId!, socket);
      } else if (message.type === 'result') {
        registry.handleResult(message as unknown as ResultMessage);
      } else if (message.type === 'error') {
        registry.handleError(message as never, deviceId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      socket.send(JSON.stringify({ type: 'error', code: 'BAD_REQUEST', message }));
      socket.close(1008, 'Invalid message');
    }
  });

  socket.on('close', () => {
    clearTimeout(registrationTimeout);
    if (registered && deviceId) registry.unregister(deviceId, socket);
  });
}
