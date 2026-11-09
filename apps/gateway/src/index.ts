import { createServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { bearerToken, tokenMatches, redactToken } from './auth.js';
import { loadGatewayConfig } from './config.js';
import { DeviceRegistry } from './device-registry.js';
import { createGatewayMcpServer } from './mcp-server.js';
import { createDeviceWebSocketServer } from './websocket-server.js';

const config = loadGatewayConfig();
const deviceToken = process.env.DEVICE_TOKEN;
if (!deviceToken) throw new Error('DEVICE_TOKEN is required');

const registry = new DeviceRegistry(deviceToken, config.callTimeoutMs, config.enableShell);
const mcpHandler = createMcpHandler(
  () => createGatewayMcpServer(registry),
  { responseMode: 'json', onerror: (error) => console.error('[mcp]', error.message) },
);
const nodeMcpHandler = toNodeHandler(mcpHandler);
const httpServer = createServer(async (req, res) => {
  if (req.url === '/healthz' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    const deviceId = registry.anyDeviceId() ?? null;
    res.end(JSON.stringify({ ok: true, deviceId, online: deviceId ? Boolean(registry.getStatus(deviceId)?.online) : false }));
    return;
  }
  if (req.url?.split('?')[0] === '/mcp') {
    const token = bearerToken(req.headers.authorization);
    if (!tokenMatches(token, config.apiToken)) {
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
      res.end(JSON.stringify({ error: 'AUTH_FAILED' }));
      return;
    }
    await nodeMcpHandler(req, res);
    return;
  }
  if (req.url?.split('?')[0] !== '/device') {
    res.writeHead(404);
    res.end('Not found');
  }
});

createDeviceWebSocketServer(httpServer, registry);
const heartbeatTimer = setInterval(() => registry.markStale(Date.now(), config.heartbeatTimeoutMs), 10_000);

httpServer.listen(config.port, () => {
  console.log(`Gateway listening on http://localhost:${config.port}`);
  console.log(`MCP API token: ${redactToken(config.apiToken)}`);
  console.log('Device WebSocket endpoint: /device');
});

async function shutdown(): Promise<void> {
  clearInterval(heartbeatTimer);
  await mcpHandler.close();
  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
