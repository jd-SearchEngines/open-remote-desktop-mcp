import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspacePathSecurity } from '../apps/agent/src/path-security.js';

test('workspace path security allows paths inside the root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'remote-mcp-test-'));
  const security = new WorkspacePathSecurity(root);
  await security.initialize();
  await assert.doesNotReject(() => security.validatePath(path.join(root, 'file.txt')));
});

test('workspace path security rejects absolute paths outside the root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'remote-mcp-test-'));
  const security = new WorkspacePathSecurity(root);
  await security.initialize();
  await assert.rejects(() => security.validatePath('/etc/passwd'), { code: 'INVALID_PATH' });
});

test('workspace path security rejects symlink escapes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'remote-mcp-test-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'remote-mcp-outside-'));
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  await mkdir(path.join(root, 'links'));
  await symlink(outside, path.join(root, 'links', 'outside'));
  const security = new WorkspacePathSecurity(root);
  await security.initialize();
  await assert.rejects(() => security.validatePath(path.join(root, 'links', 'outside', 'secret.txt')), { code: 'INVALID_PATH' });
});
