import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Read-only source inventory. Never copies credentials, data, browser sessions or build caches. */
export function managedPath(value: string): string {
  const path = value.replaceAll('\\', '/');
  if (!path || isAbsolute(path) || path.includes(':') || path.includes('\0') || path.split('/').some(p => !p || p === '.' || p === '..')) throw Error('unsafe_managed_path');
  if (path.split('/').some(p => /^\.env(?:\.|$)/i.test(p) && p !== '.env.example') || /(^|\/)(\.git|\.storage|\.pglite|node_modules|\.next|\.vercel|\.claude|credentials)(\/|\.|$)/i.test(path)) throw Error('private_path_excluded');
  return path;
}
export async function trackedManifest(root: string, paths: string[]) {
  const base = await realpath(root);
  const files = [];
  for (const input of [...paths].sort()) {
    const path = managedPath(input), source = join(base, path), canonical = await realpath(source);
    const inside = relative(base, canonical);
    if (inside.startsWith('..') || isAbsolute(inside) || (await lstat(source)).isSymbolicLink()) throw Error('managed_path_leaves_workspace');
    const stat = await lstat(source); if (!stat.isFile()) throw Error('managed_path_not_file');
    const hash = createHash('sha256'); for await (const bytes of createReadStream(source)) hash.update(bytes);
    files.push({ path, bytes: stat.size, sha256: hash.digest('hex') });
  }
  return files;
}
export function configuredEnvironment(example: string, local: string): Record<string, boolean> {
  const keys = [...example.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/gm)].flatMap(m => m[1] ? [m[1]] : []);
  const configured = new Set([...local.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*([^\r\n]*)/gm)]
    .filter(m => !/^(?:''|""|\s*|#.*)$/.test((m[2] ?? '').trim())).flatMap(m => m[1] ? [m[1]] : []));
  return Object.fromEntries(keys.map(key => [key, configured.has(key)]));
}
function git(root: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 10_000_000 });
  if (result.status !== 0) throw Error('git_inventory_failed');
  return result.stdout.trimEnd();
}
async function counts(root: string): Promise<{ files: number }> {
  let files = 0;
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const path = join(root, entry.name); if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { const child = await counts(path); files += child.files; }
    else if (entry.isFile()) files++;
  }
  return { files };
}
async function main() {
  const root = await realpath(process.cwd());
  if (await realpath(git(root, ['rev-parse', '--show-toplevel'])) !== root) throw Error('run_from_repository_root');
  const files = await trackedManifest(root, git(root, ['ls-files', '-z']).split('\0').filter(Boolean));
  const example = await readFile(join(root, '.env.example'), 'utf8');
  const local = await readFile(join(root, '.env.local'), 'utf8').catch(() => '');
  const output = resolve(root, '.agents/handoffs/server-inventory.json');
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), root, head: git(root, ['rev-parse', 'HEAD']),
    trackedWorktreeClean: !git(root, ['status', '--porcelain', '--untracked-files=no']), nodeVersion: process.version,
    files, environmentConfigured: configuredEnvironment(example, local),
    localOnly: { storage: await counts(join(root, '.storage')), pglite: await counts(join(root, '.pglite')), agentNotes: await counts(join(root, '.agents')) },
    transferred: false, containsSecretValues: false };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, head: report.head, files: files.length, trackedWorktreeClean: report.trackedWorktreeClean, transferred: false }));
}
if (resolve(process.argv[1] ?? '').toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) main().catch(() => { console.error('server_inventory_failed'); process.exitCode = 1; });
