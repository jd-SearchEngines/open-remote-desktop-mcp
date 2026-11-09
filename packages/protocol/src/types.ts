export type ErrorCode =
  | 'AUTH_FAILED'
  | 'DEVICE_OFFLINE'
  | 'DEVICE_NOT_FOUND'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_DISABLED'
  | 'TIMEOUT'
  | 'LOCAL_MCP_ERROR'
  | 'INVALID_PATH'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR';

export class RemoteMcpError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RemoteMcpError';
  }
}
