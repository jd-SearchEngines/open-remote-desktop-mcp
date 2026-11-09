import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = process.env.MCP_ENDPOINT ?? 'http://localhost:8787/mcp';
const token = process.env.MCP_API_TOKEN ?? 'dev-mcp-token';

const client = new Client({ name: 'open-remote-desktop-mcp-test-client', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  authProvider: { token: async () => token },
});

await client.connect(transport);
const listed = await client.listTools();
console.log(`tools/list: PASS (${listed.tools.length} tools)`);

const write = await client.callTool({
  name: 'write_file',
  arguments: { path: '/tmp/remote-mcp-e2e/hello.txt', content: 'hello remote mcp' },
});
assertToolSuccess(write, 'Remote write');

const read = await client.callTool({
  name: 'read_file',
  arguments: { path: '/tmp/remote-mcp-e2e/hello.txt' },
});
assertToolSuccess(read, 'Remote read');
assertContent(read, 'hello remote mcp');

const edit = await client.callTool({
  name: 'edit_block',
  arguments: {
    file_path: '/tmp/remote-mcp-e2e/hello.txt',
    old_string: 'hello remote mcp',
    new_string: 'hello open remote mcp',
  },
});
assertToolSuccess(edit, 'Remote edit');

const reread = await client.callTool({
  name: 'read_file',
  arguments: { path: '/tmp/remote-mcp-e2e/hello.txt' },
});
assertToolSuccess(reread, 'Remote reread');
assertContent(reread, 'hello open remote mcp');

console.log('Remote write: PASS');
console.log('Remote read: PASS');
console.log('Remote edit: PASS');
await client.close();

function assertToolSuccess(result: { isError?: boolean; content?: unknown }, label: string): void {
  if (result.isError) throw new Error(`${label} failed: ${JSON.stringify(result.content)}`);
}

function assertContent(result: { content?: Array<{ type?: string; text?: string }> }, expected: string): void {
  const text = result.content?.map((item) => item.text ?? '').join('\n') ?? '';
  if (!text.includes(expected)) throw new Error(`Expected tool result to contain ${expected}, received ${text}`);
}
