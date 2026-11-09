export type AgentConfig = {
  gatewayUrl: string;
  deviceId: string;
  deviceToken: string;
  workspaceRoot: string;
  enableShell: boolean;
  desktopCommanderCommand: string;
  desktopCommanderArgs: string[];
  reconnectMaxMs: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadAgentConfig(): AgentConfig {
  return {
    gatewayUrl: required('GATEWAY_URL'),
    deviceId: required('DEVICE_ID'),
    deviceToken: required('DEVICE_TOKEN'),
    workspaceRoot: required('WORKSPACE_ROOT'),
    enableShell: process.env.ENABLE_SHELL === 'true',
    desktopCommanderCommand: process.env.DESKTOP_COMMANDER_COMMAND ?? 'npx',
    desktopCommanderArgs: (process.env.DESKTOP_COMMANDER_ARGS ?? '-y,@wonderwhy-er/desktop-commander@latest')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    reconnectMaxMs: 30_000,
  };
}
