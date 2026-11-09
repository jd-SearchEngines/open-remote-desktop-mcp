import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const workspace = '/tmp/remote-mcp-e2e';
const env = {
  ...process.env,
  PORT: '8787',
  MCP_API_TOKEN: 'dev-mcp-token',
  DEVICE_ID: 'e2e-mac',
  DEVICE_TOKEN: 'dev-device-token',
  GATEWAY_URL: 'ws://localhost:8787/device',
  WORKSPACE_ROOT: workspace,
  ENABLE_SHELL: 'false',
  DESKTOP_COMMANDER_COMMAND: 'npx',
  DESKTOP_COMMANDER_ARGS: '-y,@wonderwhy-er/desktop-commander@latest',
};

await rm(workspace, { recursive: true, force: true });
await mkdir(workspace, { recursive: true });
const gateway = start('apps/gateway/src/index.ts', env);
const agent = start('apps/agent/src/index.ts', env);
try {
  await waitFor(async () => {
    const response = await fetch('http://localhost:8787/healthz');
    if (!response.ok) return false;
    const body = await response.json() as { online?: boolean };
    return body.online === true;
  }, 120_000);

  const client = await connectClient();
  const listed = await client.listTools();
  assert(listed.tools.some((tool) => tool.name === 'read_file'), 'tools/list exposes read_file');
  console.log(`Gateway: online\nDevice e2e-mac: online\nDesktop Commander: connected\ntools/list: PASS (${listed.tools.length} tools)`);

  await runRemoteChecks(client);
  await client.close();

  agent.kill('SIGTERM');
  await waitFor(async () => {
    const response = await fetch('http://localhost:8787/healthz');
    const body = await response.json() as { online?: boolean };
    return body.online === false;
  }, 20_000);
  console.log('Agent offline detection: PASS');

  const offlineClient = await connectClient();
  const offline = await offlineClient.callTool({ name: 'read_file', arguments: { path: `${workspace}/hello.txt` } });
  assert(offline.isError === true && textOf(offline).includes('DEVICE_OFFLINE'), 'offline calls return DEVICE_OFFLINE');
  await offlineClient.close();
  console.log('Device offline call: PASS');

  const reconnectedAgent = start('apps/agent/src/index.ts', env);
  try {
    await waitFor(async () => {
      const response = await fetch('http://localhost:8787/healthz');
      const body = await response.json() as { online?: boolean };
      return body.online === true;
    }, 120_000);
    const reconnectedClient = await connectClient();
    const result = await reconnectedClient.callTool({ name: 'read_file', arguments: { path: `${workspace}/hello.txt` } });
    assert(!result.isError && textOf(result).includes('hello open remote mcp'), 'calls recover after agent reconnect');
    await reconnectedClient.close();
    console.log('Reconnect: PASS');
  } finally {
    reconnectedAgent.kill('SIGTERM');
  }
} finally {
  gateway.kill('SIGTERM');
  agent.kill('SIGTERM');
}

async function runRemoteChecks(client: Client): Promise<void> {
  const write = await client.callTool({ name: 'write_file', arguments: { path: `${workspace}/hello.txt`, content: 'hello remote mcp' } });
  assert(!write.isError, 'write_file succeeds');
  console.log('Remote write: PASS');
  const read = await client.callTool({ name: 'read_file', arguments: { path: `${workspace}/hello.txt` } });
  assert(!read.isError && textOf(read).includes('hello remote mcp'), 'read_file succeeds');
  console.log('Remote read: PASS');
  const edit = await client.callTool({ name: 'edit_block', arguments: { file_path: `${workspace}/hello.txt`, old_string: 'hello remote mcp', new_string: 'hello open remote mcp' } });
  assert(!edit.isError, 'edit_block succeeds');
  const reread = await client.callTool({ name: 'read_file', arguments: { path: `${workspace}/hello.txt` } });
  assert(!reread.isError && textOf(reread).includes('hello open remote mcp'), 'edited file can be read');
  console.log('Remote edit: PASS');
  const outside = await client.callTool({ name: 'read_file', arguments: { path: '/etc/passwd' } });
  assert(outside.isError === true && textOf(outside).includes('INVALID_PATH'), 'path isolation rejects /etc/passwd');
  console.log('Path isolation: PASS');
}

async function connectClient(): Promise<Client> {
  const client = new Client({ name: 'e2e-client', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:8787/mcp'), {
    authProvider: { token: async () => 'dev-mcp-token' },
  }));
  return client;
}

function start(script: string, childEnv: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', script], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[${script}] ${chunk}`));
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[${script}] ${chunk}`));
  return child;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // The service may not have started yet.
    }
    await delay(500);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function textOf(result: { content?: readonly unknown[] }): string {
  return result.content?.map((item) => {
    if (typeof item === 'object' && item !== null && 'text' in item) return String(item.text ?? '');
    return '';
  }).join('\n') ?? '';
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
