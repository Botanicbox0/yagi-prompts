import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { RUNTIME_MODE_ENV, describeRuntimeSelection } from '@/lib/runtime-mode';

/**
 * `npm run build:local` · `npm run start:local` — run Next with the cloud switched OFF.
 *
 * Next reads `.env.local` for `dev`, `build` AND `start`, and this machine's `.env.local` now holds
 * live Supabase credentials (M7). Without this wrapper, the offline proof — `npm run db:local` →
 * build → start → `npm run sweep:anon`, 294 checks against the fixture snapshot — would quietly
 * run against an EMPTY cloud database and fail for a reason that has nothing to do with the code.
 *
 * It works because Next never overwrites a variable that is already in `process.env`: setting
 * `PLAYBOOK_MODE=local` here beats anything the env files say. `npm run build` / `npm start` with
 * no wrapper stay exactly as they were — cloud when `DATABASE_URL` is present, which is what a
 * deployment wants.
 *
 * A tsx wrapper rather than an inline `PLAYBOOK_MODE=local next build`, because that syntax is not
 * portable to PowerShell and `cross-env` would be a new dependency for one line.
 */

const ALLOWED = new Set(['build', 'start', 'dev']);

function usage(): never {
  console.error(`usage: tsx scripts/run-local.ts <${[...ALLOWED].join('|')}> [...next args]`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
if (!command || !ALLOWED.has(command)) usage();

const env = { ...process.env, [RUNTIME_MODE_ENV]: 'local' };
console.log(`next ${command} → ${describeRuntimeSelection(env)}\n`);

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, command, ...rest], { stdio: 'inherit', env });
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
