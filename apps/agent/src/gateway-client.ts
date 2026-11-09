import WebSocket from 'ws';
import {
  PROTOCOL_VERSION,
  type CallMessage,
  type ToolDefinition,
  type AgentToGatewayMessage,
} from '@open-remote-desktop-mcp/protocol';
import type { AgentConfig } from './config.js';
import { DesktopCommanderClient } from './desktop-commander-client.js';
import { WorkspacePathSecurity } from './path-security.js';

export class GatewayAgent {
  private stopping = false;
  private socket?: WebSocket;
  private heartbeatTimer?: NodeJS.Timeout;
  private tools: ToolDefinition[] = [];

  constructor(
    private readonly config: AgentConfig,
    private readonly desktop: DesktopCommanderClient,
    private readonly paths: WorkspacePathSecurity,
  ) {}

  async run(): Promise<void> {
    this.tools = await this.desktop.connect(this.config);
    console.log(`Desktop Commander: connected (${this.tools.length} tools)`);
    let delayMs = 1_000;
    while (!this.stopping) {
      try {
        await this.connectOnce();
        delayMs = 1_000;
      } catch (error) {
        if (!this.stopping) console.error(`[agent] ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!this.stopping) {
        await wait(delayMs);
        delayMs = Math.min(delayMs * 2, this.config.reconnectMaxMs);
      }
    }
  }

  stop(): void {
    this.stopping = true;
    clearInterval(this.heartbeatTimer);
    this.socket?.close();
  }

  private async connectOnce(): Promise<void> {
    const socket = new WebSocket(this.config.gatewayUrl);
    this.socket = socket;
    await waitForOpen(socket);
    socket.send(JSON.stringify({
      type: 'register',
      protocolVersion: PROTOCOL_VERSION,
      deviceId: this.config.deviceId,
      token: this.config.deviceToken,
      tools: this.tools,
    }));
    await waitForRegistered(socket, this.config.deviceId);
    console.log(`Device ${this.config.deviceId}: online`);
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'heartbeat', deviceId: this.config.deviceId, at: Date.now() }));
      }
    }, 10_000);
    socket.on('message', (raw) => void this.handleMessage(raw.toString(), socket));
    await waitForClose(socket);
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    if (!this.stopping) throw new Error('Gateway connection closed; retrying');
  }

  private async handleMessage(raw: string, socket: WebSocket): Promise<void> {
    let message: AgentToGatewayMessage | CallMessage;
    try {
      message = JSON.parse(raw) as AgentToGatewayMessage | CallMessage;
    } catch {
      socket.send(JSON.stringify({ type: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON' }));
      return;
    }
    if (message.type !== 'call') return;

    try {
      if (isShellTool(message.tool) && !this.config.enableShell) {
        throw Object.assign(new Error('Shell tools are disabled on this Agent'), { code: 'TOOL_DISABLED' });
      }
      const args = await this.paths.validateArguments(message.tool, message.arguments ?? {});
      const result = await this.desktop.callTool(message.tool, args);
      socket.send(JSON.stringify({
        type: 'result',
        callId: message.callId,
        deviceId: this.config.deviceId,
        tool: message.tool,
        success: !result.isError,
        result,
        ...(result.isError ? { error: { code: 'LOCAL_MCP_ERROR', message: extractResultError(result) } } : {}),
      }));
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'LOCAL_MCP_ERROR';
      const text = error instanceof Error ? error.message : String(error);
      socket.send(JSON.stringify({
        type: 'result',
        callId: message.callId,
        deviceId: this.config.deviceId,
        tool: message.tool,
        success: false,
        error: { code, message: text },
      }));
    }
  }
}

function isShellTool(tool: string): boolean {
  return new Set(['start_process', 'read_process_output', 'interact_with_process', 'force_terminate', 'list_sessions']).has(tool);
}

function extractResultError(result: { content?: Array<{ type?: string; text?: string }> }): string {
  return result.content?.map((item) => item.text ?? '').join('\n') || 'Desktop Commander returned an error';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function waitForRegistered(socket: WebSocket, deviceId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as { type?: string; deviceId?: string; message?: string };
      if (message.type === 'registered' && message.deviceId === deviceId) {
        socket.off('message', onMessage);
        resolve();
      } else if (message.type === 'error') {
        socket.off('message', onMessage);
        reject(new Error(message.message ?? 'Gateway registration failed'));
      }
    };
    socket.on('message', onMessage);
    socket.once('error', reject);
    socket.once('close', () => reject(new Error('Gateway closed during registration')));
  });
}

function waitForClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('close', () => resolve());
    socket.once('error', reject);
  });
}
