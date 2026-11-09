import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = process.env.MCP_ENDPOINT ?? 'http://localhost:8787/mcp';
const token = process.env.MCP_API_TOKEN;
if (!token) throw new Error('MCP_API_TOKEN is required');

const client = new Client({ name: 'open-remote-desktop-mcp-verify', version: '0.1.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    authProvider: { token: async () => token },
  }));
  const result = await client.listTools();
  console.log(`MCP endpoint: ${endpoint}`);
  console.log('Connection: PASS');
  console.log(`Tools discovered: ${result.tools.length}`);
  console.log(result.tools.map((tool) => `- ${tool.name}`).join('\n'));
} finally {
  await client.close().catch(() => undefined);
}
