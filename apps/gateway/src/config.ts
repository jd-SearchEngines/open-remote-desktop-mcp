export type GatewayConfig = {
  port: number;
  apiToken: string;
  callTimeoutMs: number;
  heartbeatTimeoutMs: number;
  enableShell: boolean;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadGatewayConfig(): GatewayConfig {
  return {
    port: Number(process.env.PORT ?? 8787),
    apiToken: required('MCP_API_TOKEN'),
    callTimeoutMs: Number(process.env.CALL_TIMEOUT_MS ?? 30_000),
    heartbeatTimeoutMs: 30_000,
    enableShell: process.env.ENABLE_SHELL === 'true',
  };
}
