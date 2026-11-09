import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { RemoteMcpError } from '@open-remote-desktop-mcp/protocol';

export class WorkspacePathSecurity {
  private rootRealpath?: string;

  constructor(private readonly configuredRoot: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.configuredRoot, { recursive: true });
    this.rootRealpath = await realpath(this.configuredRoot);
  }

  async validateArguments(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (isShellTool(tool)) return args;
    return await this.normalizeValue(structuredClone(args), undefined) as Record<string, unknown>;
  }

  private async normalizeValue(value: unknown, key: string | undefined): Promise<unknown> {
    if (typeof value === 'string' && key && isPathKey(key)) {
      return this.validatePath(value);
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => this.normalizeValue(item, key)));
    }
    if (value && typeof value === 'object') {
      const entries = await Promise.all(Object.entries(value).map(async ([childKey, childValue]) => [
        childKey,
        await this.normalizeValue(childValue, childKey),
      ] as const));
      return Object.fromEntries(entries);
    }
    return value;
  }

  async validatePath(input: string): Promise<string> {
    if (!this.rootRealpath) throw new Error('Workspace path security is not initialized');
    if (input.includes('\0')) throw new RemoteMcpError('INVALID_PATH', 'Path contains a null byte');
    const candidate = path.isAbsolute(input) ? path.normalize(input) : path.resolve(this.rootRealpath, input);
    const existingAncestor = await this.realpathNearestExisting(candidate);
    if (!isWithin(this.rootRealpath, existingAncestor)) {
      throw new RemoteMcpError('INVALID_PATH', `Path is outside WORKSPACE_ROOT: ${input}`);
    }
    return candidate;
  }

  private async realpathNearestExisting(candidate: string): Promise<string> {
    try {
      return await realpath(candidate);
    } catch (error) {
      const parent = path.dirname(candidate);
      if (parent === candidate) throw new RemoteMcpError('INVALID_PATH', `Unable to resolve path: ${candidate}`, { cause: String(error) });
      return this.realpathNearestExisting(parent);
    }
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isPathKey(key: string): boolean {
  return new Set([
    'path', 'paths', 'directory', 'directories', 'file_path', 'filePath', 'filePaths',
    'cwd', 'workingDirectory', 'workspaceRoot', 'source', 'destination',
  ]).has(key);
}

function isShellTool(tool: string): boolean {
  return new Set(['start_process', 'read_process_output', 'interact_with_process', 'force_terminate', 'list_sessions']).has(tool);
}
