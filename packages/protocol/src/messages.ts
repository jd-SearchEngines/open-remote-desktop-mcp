export const PROTOCOL_VERSION = 1;

export type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type RegisterMessage = {
  type: 'register';
  protocolVersion: number;
  deviceId: string;
  token: string;
  tools: ToolDefinition[];
};

export type RegisteredMessage = {
  type: 'registered';
  protocolVersion: number;
  deviceId: string;
};

export type CallMessage = {
  type: 'call';
  callId: string;
  deviceId: string;
  tool: string;
  arguments: Record<string, unknown>;
  timeoutMs: number;
};

export type ResultMessage = {
  type: 'result';
  callId: string;
  deviceId: string;
  tool: string;
  success: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
};

export type HeartbeatMessage = {
  type: 'heartbeat';
  deviceId: string;
  at: number;
};

export type ErrorMessage = {
  type: 'error';
  code: string;
  message: string;
  callId?: string;
};

export type AgentToGatewayMessage = RegisteredMessage | ResultMessage | ErrorMessage | HeartbeatMessage;
export type GatewayToAgentMessage = CallMessage | ErrorMessage;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseMessage(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  return value;
}
