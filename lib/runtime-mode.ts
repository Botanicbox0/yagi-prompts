import { DEFAULT_LOCAL_SNAPSHOT, LOCAL_DB_DIR_ENV } from './db/connect-shared';

/**
 * M7 — the ONE switch that decides whether this process talks to the cloud (§13 ship pass).
 *
 * Until M6 the answer was inferred from `DATABASE_URL`: absent meant "no cloud project exists yet",
 * which was true on every machine. It stopped being true the moment `.env.local` gained real
 * Supabase credentials — and `.env.local` is read by `next dev`, `next build` AND `next start`, so
 * without a switch every "local" flow (the PGlite snapshot, the sweep, the fixture identities,
 * `npm run db:local`) would silently start reading a live, EMPTY cloud database and writing to live
 * buckets. The local flows are how this repo proves anything, so they have to stay hermetic on a
 * machine that also has production keys sitting in the same file.
 *
 * PLAYBOOK_MODE=local   PGlite (durable dir, else snapshot) + `.storage/` driver + no public CDN
 *                       URLs, REGARDLESS of DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL being present.
 * PLAYBOOK_MODE=cloud   `pg` against DATABASE_URL + the Supabase storage driver + public bucket
 *                       URLs on the project host.
 * unset                 inferred, exactly as M0–M6 behaved: DATABASE_URL present ⇒ cloud, else local.
 *                       Deployments therefore work with no new variable, and a fresh clone with an
 *                       empty env still gets the local path.
 *
 * Precedence, in full (also written out in docs/SETUP.md):
 *   1. `STORAGE_DRIVER`  — explicit per-driver override, wins over the mode. Escape hatch only.
 *   2. `PLAYBOOK_MODE`   — the switch.
 *   3. `DATABASE_URL`    — the legacy inference.
 *
 * Everything here is a PURE function of an env bag so the selection matrix is testable without
 * mutating the real process env (tests/runtime/mode.test.ts).
 */

export type RuntimeMode = 'local' | 'cloud';

export const RUNTIME_MODE_ENV = 'PLAYBOOK_MODE';

export type EnvLike = Record<string, string | undefined>;

function trimmed(value: string | undefined): string | undefined {
  const out = value?.trim();
  return out ? out : undefined;
}

/**
 * An explicitly-set, *understood* mode. A typo (`PLAYBOOK_MODE=prod`) is deliberately NOT fatal:
 * it falls through to inference rather than taking a deployment down, and says so once.
 */
export function explicitRuntimeMode(env: EnvLike = process.env): RuntimeMode | null {
  const raw = trimmed(env[RUNTIME_MODE_ENV])?.toLowerCase();
  if (raw === undefined) return null;
  if (raw === 'local' || raw === 'cloud') return raw;
  warnOnce(
    `[mode] ${RUNTIME_MODE_ENV}="${raw}" is not 'local' or 'cloud' — falling back to inference.`,
  );
  return null;
}

export function resolveRuntimeMode(env: EnvLike = process.env): RuntimeMode {
  return explicitRuntimeMode(env) ?? (trimmed(env.DATABASE_URL) ? 'cloud' : 'local');
}

// ---------------------------------------------------------------------------
// database
// ---------------------------------------------------------------------------

export type DbSelection =
  | { driver: 'pg'; connectionString: string }
  /** `snapshotPath` is the fallback when the directory is already locked by another process. */
  | { driver: 'pglite-dir'; dir: string; snapshotPath: string }
  | { driver: 'pglite-snapshot'; path: string }
  | { driver: 'none'; reason: string };

/**
 * Which SqlRunner this process should open. `none` is a first-class answer — the public catalog
 * degrades to its empty state so `next build` stays green on a machine with no database at all.
 */
export function selectDbDriver(env: EnvLike = process.env): DbSelection {
  const mode = resolveRuntimeMode(env);

  if (mode === 'cloud') {
    const connectionString = trimmed(env.DATABASE_URL);
    if (connectionString) return { driver: 'pg', connectionString };
    return { driver: 'none', reason: 'cloud mode without DATABASE_URL' };
  }

  // Local mode ignores DATABASE_URL on purpose: that is the whole point of the switch.
  const snapshotPath = trimmed(env.PLAYBOOK_LOCAL_DB) ?? DEFAULT_LOCAL_SNAPSHOT;
  const dir = trimmed(env[LOCAL_DB_DIR_ENV]);
  if (dir) return { driver: 'pglite-dir', dir, snapshotPath };
  return { driver: 'pglite-snapshot', path: snapshotPath };
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

export type StorageDriverName = 'local' | 'supabase';

export function selectStorageDriver(env: EnvLike = process.env): StorageDriverName {
  const override = trimmed(env.STORAGE_DRIVER)?.toLowerCase();
  if (override === 'local' || override === 'supabase') return override;
  if (override !== undefined) {
    warnOnce(`[mode] STORAGE_DRIVER="${override}" is not 'local' or 'supabase' — using the mode.`);
  }
  return resolveRuntimeMode(env) === 'cloud' ? 'supabase' : 'local';
}

/**
 * The host that serves `public-content`, or `undefined` when nothing does.
 *
 * This is the subtle half of the switch. `NEXT_PUBLIC_SUPABASE_URL` is set on a machine running in
 * LOCAL mode too (same `.env.local`), but in local mode the published objects live under
 * `.storage/` and the cloud bucket has never seen them — so emitting a project URL would render
 * cards pointing at objects that do not exist there. `undefined` sends the caller down the
 * gateway/generated-cover fallback that already exists for the no-project case.
 *
 * Read on the SERVER only (`lib/content/asset-url.ts` is imported by RSCs and route handlers, never
 * by a `'use client'` module) — `PLAYBOOK_MODE` is not a `NEXT_PUBLIC_` variable and would be
 * `undefined` in a browser bundle.
 */
export function publicStorageBaseUrl(env: EnvLike = process.env): string | undefined {
  if (resolveRuntimeMode(env) === 'local') return undefined;
  return trimmed(env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * The R2 host for copied `public-content` objects (`media.twings.app`), or `undefined` to stay on
 * Supabase. Unset is the rollback. Local mode ignores it for the same reason as above. A value that
 * is not https is refused: it would put mixed-content media on every public page.
 */
export function publicMediaBaseUrl(env: EnvLike = process.env): string | undefined {
  if (resolveRuntimeMode(env) === 'local') return undefined;
  const value = trimmed(env.PUBLIC_MEDIA_BASE_URL);
  return value?.startsWith('https://') ? value : undefined;
}

export interface PublicMediaR2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  mediaBaseUrl: string;
}

/**
 * What writing public files straight to R2 needs (docs/BRAND-MOAT-AND-STORAGE.md), or `null` with any
 * value missing. `null` keeps publishing to Supabase, and only the keys in
 * `lib/content/public-media-keys.ts` go to the media host.
 */
export function publicMediaR2Config(env: EnvLike = process.env): PublicMediaR2Config | null {
  const mediaBaseUrl = publicMediaBaseUrl(env);
  const accountId = trimmed(env.R2_ACCOUNT_ID);
  const accessKeyId = trimmed(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = trimmed(env.R2_SECRET_ACCESS_KEY);
  const bucket = trimmed(env.R2_PUBLIC_BUCKET);
  if (!mediaBaseUrl || !accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, mediaBaseUrl };
}

// ---------------------------------------------------------------------------

const warned = new Set<string>();

/** One line per distinct message per process — this is read on every request in dev. */
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/** One line for a script banner: `local · pglite-snapshot · storage:local`. */
export function describeRuntimeSelection(env: EnvLike = process.env): string {
  const db = selectDbDriver(env);
  return `${resolveRuntimeMode(env)} · db:${db.driver} · storage:${selectStorageDriver(env)}`;
}
