import type { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  type CallMessage,
  type RegisterMessage,
  type ResultMessage,
  type ToolDefinition,
  type ErrorMessage,
  RemoteMcpError,
} from '@open-remote-desktop-mcp/protocol';
import { randomUUID } from 'node:crypto';
import { tokenMatches } from './auth.js';

export const DEFAULT_TOOL_ALLOWLIST = new Set([
  'list_directory',
  'read_file',
  'read_multiple_files',
  'get_file_info',
  'start_search',
  'get_more_search_results',
  'stop_search',
  'write_file',
  'edit_block',
  'create_directory',
  'move_file',
]);

export const SHELL_TOOL_ALLOWLIST = new Set([
  'start_process',
  'read_process_output',
  'interact_with_process',
  'force_terminate',
  'list_sessions',
]);

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  tool: string;
};

export type DeviceStatus = {
  deviceId: string;
  online: boolean;
  tools: ToolDefinition[];
  lastHeartbeat: number;
};

type DeviceRecord = DeviceStatus & {
  socket?: WebSocket;
  pending: Map<string, PendingCall>;
};

export class DeviceRegistry {
  private readonly devices = new Map<string, DeviceRecord>();

  constructor(
    private readonly deviceToken: string,
    private readonly callTimeoutMs: number,
    private readonly enableShell: boolean,
  ) {}

  register(message: RegisterMessage, socket: WebSocket): void {
    if (message.protocolVersion !== PROTOCOL_VERSION) {
      throw new RemoteMcpError('BAD_REQUEST', 'Unsupported device protocol version');
    }
    if (!tokenMatches(message.token, this.deviceToken)) {
      throw new RemoteMcpError('AUTH_FAILED', 'Invalid device token');
    }
    if (!message.deviceId || !Array.isArray(message.tools)) {
      throw new RemoteMcpError('BAD_REQUEST', 'Invalid registration message');
    }

    const previous = this.devices.get(message.deviceId);
    if (previous?.socket && previous.socket !== socket) {
      previous.socket.close(1000, 'Replaced by a newer connection');
      this.rejectPending(previous, new RemoteMcpError('DEVICE_OFFLINE', 'Device connection replaced'));
    }

    this.devices.set(message.deviceId, {
      deviceId: message.deviceId,
      online: true,
      tools: this.filterTools(message.tools),
      lastHeartbeat: Date.now(),
      socket,
      pending: previous?.pending ?? new Map(),
    });
  }

  unregister(deviceId: string, socket: WebSocket): void {
    const device = this.devices.get(deviceId);
    if (!device || device.socket !== socket) return;
    device.online = false;
    device.socket = undefined;
    this.rejectPending(device, new RemoteMcpError('DEVICE_OFFLINE', 'Device is offline'));
  }

  heartbeat(deviceId: string, socket: WebSocket): void {
    const device = this.devices.get(deviceId);
    if (!device || device.socket !== socket) return;
    device.online = true;
    device.lastHeartbeat = Date.now();
  }

  markStale(now = Date.now(), timeoutMs = 30_000): void {
    for (const device of this.devices.values()) {
      if (device.online && now - device.lastHeartbeat > timeoutMs) {
        device.online = false;
        device.socket?.terminate();
        device.socket = undefined;
        this.rejectPending(device, new RemoteMcpError('DEVICE_OFFLINE', 'Device heartbeat timed out'));
      }
    }
  }

  listTools(deviceId: string): ToolDefinition[] {
    const device = this.devices.get(deviceId);
    if (!device) return [];
    return device.tools;
  }

  getStatus(deviceId: string): DeviceStatus | undefined {
    const device = this.devices.get(deviceId);
    if (!device) return undefined;
    return {
      deviceId: device.deviceId,
      online: device.online,
      tools: device.tools,
      lastHeartbeat: device.lastHeartbeat,
    };
  }

  firstDeviceId(): string | undefined {
    return [...this.devices.values()].find((device) => device.online)?.deviceId;
  }

  anyDeviceId(): string | undefined {
    return this.devices.keys().next().value;
  }

  async call(deviceId: string, tool: string, args: Record<string, unknown>, timeoutMs = this.callTimeoutMs): Promise<unknown> {
    const device = this.devices.get(deviceId);
    if (!device) throw new RemoteMcpError('DEVICE_NOT_FOUND', `Device ${deviceId} is not registered`);
    if (!device.online || !device.socket) throw new RemoteMcpError('DEVICE_OFFLINE', `Device ${deviceId} is offline`);
    if (!device.tools.some((candidate) => candidate.name === tool)) {
      throw new RemoteMcpError('TOOL_NOT_FOUND', `Tool ${tool} is not available on device ${deviceId}`);
    }

    const callId = randomUUID();
    const message: CallMessage = {
      type: 'call',
      callId,
      deviceId,
      tool,
      arguments: args,
      timeoutMs,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        device.pending.delete(callId);
        reject(new RemoteMcpError('TIMEOUT', `Tool ${tool} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      device.pending.set(callId, { resolve, reject, timer, tool });
      try {
        device.socket?.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        device.pending.delete(callId);
        reject(new RemoteMcpError('DEVICE_OFFLINE', `Unable to send call to ${deviceId}`, { cause: String(error) }));
      }
    });
  }

  handleResult(message: ResultMessage): void {
    const device = this.devices.get(message.deviceId);
    const pending = device?.pending.get(message.callId);
    if (!pending) return;
    clearTimeout(pending.timer);
    device?.pending.delete(message.callId);
    if (message.success) pending.resolve(message.result);
    else pending.reject(new RemoteMcpError(
      (message.error?.code as ConstructorParameters<typeof RemoteMcpError>[0]) ?? 'LOCAL_MCP_ERROR',
      message.error?.message ?? 'Local tool call failed',
    ));
  }

  handleError(message: ErrorMessage, deviceId?: string): void {
    if (!deviceId || !message.callId) return;
    const device = this.devices.get(deviceId);
    const pending = device?.pending.get(message.callId);
    if (!pending) return;
    clearTimeout(pending.timer);
    device?.pending.delete(message.callId);
    pending.reject(new RemoteMcpError('LOCAL_MCP_ERROR', message.message));
  }

  private filterTools(tools: ToolDefinition[]): ToolDefinition[] {
    const allowed = new Set(DEFAULT_TOOL_ALLOWLIST);
    if (this.enableShell) for (const tool of SHELL_TOOL_ALLOWLIST) allowed.add(tool);
    return tools.filter((tool) => allowed.has(tool.name));
  }

  private rejectPending(device: DeviceRecord, error: Error): void {
    for (const pending of device.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    device.pending.clear();
  }
}
