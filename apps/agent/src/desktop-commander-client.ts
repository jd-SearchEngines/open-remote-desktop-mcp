import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { CallToolResult } from '@modelcontextprotocol/client';
import type { ToolDefinition } from '@open-remote-desktop-mcp/protocol';
import type { AgentConfig } from './config.js';

export class DesktopCommanderClient {
  private client?: Client;
  private transport?: StdioClientTransport;

  async connect(config: AgentConfig): Promise<ToolDefinition[]> {
    this.client = new Client({ name: 'open-remote-desktop-mcp-agent', version: '0.1.0' });
    this.transport = new StdioClientTransport({
      command: config.desktopCommanderCommand,
      args: config.desktopCommanderArgs,
      stderr: 'inherit',
    });
    this.transport.onerror = (error: Error) => console.error('[desktop-commander]', error.message);
    await this.client.connect(this.transport);
    const response = await this.client.listTools();
    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.client) throw new Error('Desktop Commander is not connected');
    return this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
    this.transport = undefined;
  }
}
