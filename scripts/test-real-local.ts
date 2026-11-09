import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = process.env.MCP_ENDPOINT ?? 'http://localhost:8787/mcp';
const token = process.env.MCP_API_TOKEN;
const workspace = process.env.WORKSPACE_ROOT;

if (!token) throw new Error('MCP_API_TOKEN is required');
if (!workspace) throw new Error('WORKSPACE_ROOT is required');

const client = new Client({ name: 'open-remote-desktop-mcp-real-test', version: '0.1.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
  authProvider: { token: async () => token },
}));

try {
  const listed = await client.listTools();
  const requiredTools = ['read_file', 'write_file', 'edit_block', 'list_directory'];
  for (const name of requiredTools) assert(listed.tools.some((tool) => tool.name === name), `tools/list exposes ${name}`);
  console.log(`Connection: PASS\nTools discovered: ${listed.tools.length}`);

  const file = path.join(workspace, 'real-test.txt');
  const write = await client.callTool({ name: 'write_file', arguments: { path: file, content: 'hello from remote mcp' } });
  assert(!write.isError, 'write_file succeeds');
  assertRawToolResult(write, 'write_file');
  console.log('Remote write: PASS');

  const read = await client.callTool({ name: 'read_file', arguments: { path: file } });
  assert(!read.isError && textOf(read).includes('hello from remote mcp'), 'read_file returns the written content');
  assertRawToolResult(read, 'read_file');
  console.log('Remote read: PASS');

  const edit = await client.callTool({
    name: 'edit_block',
    arguments: {
      file_path: file,
      old_string: 'hello from remote mcp',
      new_string: 'hello from open remote desktop mcp',
    },
  });
  assert(!edit.isError, 'edit_block succeeds');
  assertRawToolResult(edit, 'edit_block');
  console.log('Remote edit: PASS');

  const reread = await client.callTool({ name: 'read_file', arguments: { path: file } });
  assert(!reread.isError && textOf(reread).includes('hello from open remote desktop mcp'), 'read_file returns the edited content');
  console.log('Final content: PASS');

  const outside = await client.callTool({ name: 'read_file', arguments: { path: '/etc/passwd' } });
  assert(outside.isError === true && textOf(outside).includes('INVALID_PATH'), 'outside workspace access fails');
  console.log('Path isolation: PASS');
} finally {
  await client.close();
}

function assertRawToolResult(result: { content?: readonly unknown[] }, tool: string): void {
  const nested = result.content?.some((item) => {
    if (!isObject(item) || typeof item.text !== 'string') return false;
    try {
      const parsed = JSON.parse(item.text) as unknown;
      return isObject(parsed) && Array.isArray(parsed.content);
    } catch {
      return false;
    }
  });
  assert(!nested, `${tool} preserves the original CallToolResult envelope`);
}

function textOf(result: { content?: readonly unknown[] }): string {
  return result.content?.map((item) => {
    if (isObject(item) && 'text' in item) return String(item.text ?? '');
    return '';
  }).join('\n') ?? '';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
