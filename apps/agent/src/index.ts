import { loadAgentConfig } from './config.js';
import { DesktopCommanderClient } from './desktop-commander-client.js';
import { GatewayAgent } from './gateway-client.js';
import { WorkspacePathSecurity } from './path-security.js';

const config = loadAgentConfig();
const paths = new WorkspacePathSecurity(config.workspaceRoot);
await paths.initialize();
const desktop = new DesktopCommanderClient();
const agent = new GatewayAgent(config, desktop, paths);

const shutdown = async () => {
  agent.stop();
  await desktop.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`Agent workspace: ${config.workspaceRoot}`);
await agent.run();
