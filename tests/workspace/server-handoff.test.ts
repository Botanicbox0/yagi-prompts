import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configuredEnvironment, managedPath, trackedManifest } from '@/scripts/server-handoff-inventory';

describe('server handoff inventory boundaries', () => {
  it('refuses private paths and escapes while allowing the public env example', () => {
    for (const path of ['../outside', 'C:/outside', '/outside', '.env.local', 'nested/.env.production', '.storage/photo.jpg', '.pglite/data', '.vercel/project.json', '.claude/settings.json', 'credentials.json']) expect(() => managedPath(path)).toThrow();
    expect(managedPath('.env.example')).toBe('.env.example');
    expect(managedPath('docs\\SERVER-HANDOFF.md')).toBe('docs/SERVER-HANDOFF.md');
  });
  it('never exports environment values or unknown private variable names', () => {
    const result = configuredEnvironment('API_KEY=\nEMPTY=\n', 'API_KEY=sentinel-not-for-export\nEMPTY=""\nPRIVATE_ONLY=secret\n');
    expect(result).toEqual({ API_KEY: true, EMPTY: false });
    expect(JSON.stringify(result)).not.toMatch(/sentinel|secret|PRIVATE_ONLY/);
  });
  it.each(['\n', '\r\n'])('keeps empty values empty with %j line endings', newline => {
    const example = `A=${newline}B=${newline}`;
    expect(configuredEnvironment(example, `A=${newline}B=x${newline}`)).toEqual({ A: false, B: true });
  });
  it('hashes only managed source and refuses an external symbolic link', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'twings-handoff-'));
    try {
      const root = join(parent, 'repo'); await mkdir(root); await writeFile(join(root, 'source.ts'), 'source');
      const records = await trackedManifest(root, ['source.ts']);
      expect(records).toEqual([{ path: 'source.ts', bytes: 6, sha256: '41cf6794ba4200b839c53531555f0f3998df4cbb01a4d5cb0b94e3ca5e23947d' }]);
      const outside = join(parent, 'outside'); await mkdir(outside); await writeFile(join(outside, 'private.ts'), 'private');
      await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(trackedManifest(root, ['linked/private.ts'])).rejects.toThrow('managed_path_leaves_workspace');
    } finally {
      const inside = relative(resolve(tmpdir()), resolve(parent));
      if (!inside || inside.startsWith('..') || isAbsolute(inside) || !inside.startsWith('twings-handoff-')) throw Error('unsafe_fixture_cleanup');
      await rm(parent, { recursive: true, force: true });
    }
  });
});
