import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import type { ToolDefinition } from '@open-remote-desktop-mcp/protocol';
import { DeviceRegistry } from './device-registry.js';

export function createGatewayMcpServer(registry: DeviceRegistry, deviceId?: string): McpServer {
  const server = new McpServer({ name: 'open-remote-desktop-mcp-gateway', version: '0.1.0' });
  const selectedDevice = deviceId ?? registry.firstDeviceId() ?? registry.anyDeviceId();
  const tools = selectedDevice ? registry.listTools(selectedDevice) : [];

  for (const tool of tools) registerProxyTool(server, registry, selectedDevice!, tool);
  return server;
}

function registerProxyTool(server: McpServer, registry: DeviceRegistry, deviceId: string, tool: ToolDefinition): void {
  server.registerTool(
    tool.name,
    {
      description: tool.description ?? `Desktop Commander tool: ${tool.name}`,
      inputSchema: fromJsonSchema(tool.inputSchema),
    },
    async (args) => {
      try {
        const result = await registry.call(deviceId, tool.name, (args ?? {}) as Record<string, unknown>);
        return {
          content: [{ type: 'text' as const, text: stringifyToolResult(result) }],
          structuredContent: isObject(result) ? result : undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = isRemoteError(error) ? error.code : 'INTERNAL_ERROR';
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `[${code}] ${message}` }],
        };
      }
    },
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? String(value);
}

function isRemoteError(value: unknown): value is { code: string } {
  return typeof value === 'object' && value !== null && 'code' in value;
}
