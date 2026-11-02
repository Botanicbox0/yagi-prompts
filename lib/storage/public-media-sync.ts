import { createHash } from 'node:crypto';

/**
 * docs/BRAND-MOAT-AND-STORAGE.md — copies `public-content` to the R2 public bucket and decides which
 * keys the site may serve from there. A key counts only after the public host returned the same
 * bytes, the same type and, for video and audio, a working range request.
 *
 * Only content-addressed keys are copied. Their bytes never change, so they can be cached forever,
 * and they are what published templates and landing slots point at. Folders such as `temp-dm/` hold
 * temporary uploads that no page references, and they stay where they are.
 */
export const PUBLIC_MEDIA_KEY_PATTERN = /^[0-9a-f]{64}\.[a-z0-9]+$/;
export const PUBLIC_MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const RANGE_PROBE_BYTES = 1024;

export interface PublicMediaObject {
  key: string;
  size: number;
  mime: string;
}

export interface PublicMediaRead {
  status: number;
  contentType: string | null;
  contentRange: string | null;
  cacheControl: string | null;
  bytes: Uint8Array;
}

export interface PublicMediaSyncDeps {
  list(): Promise<PublicMediaObject[]>;
  read(key: string): Promise<Uint8Array>;
  put(key: string, bytes: Uint8Array, meta: { mime: string; cacheControl: string }): Promise<void>;
  publicGet(key: string, range?: { start: number; end: number }): Promise<PublicMediaRead>;
}

export type PublicMediaFailure =
  | 'name_hash_mismatch'
  | 'public_read_failed'
  | 'public_bytes_mismatch'
  | 'public_type_mismatch'
  | 'public_cache_mismatch'
  | 'range_not_supported'
  | 'copy_error';

export interface PublicMediaSyncReport {
  verified: string[];
  failed: { key: string; reason: PublicMediaFailure }[];
  skipped: string[];
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function copyAndVerify(deps: PublicMediaSyncDeps, object: PublicMediaObject): Promise<PublicMediaFailure | null> {
  const source = await deps.read(object.key);
  const hash = sha256(source);
  if (!object.key.startsWith(`${hash}.`)) return 'name_hash_mismatch';

  await deps.put(object.key, source, { mime: object.mime, cacheControl: PUBLIC_MEDIA_CACHE_CONTROL });

  const full = await deps.publicGet(object.key);
  if (full.status !== 200) return 'public_read_failed';
  if (sha256(full.bytes) !== hash) return 'public_bytes_mismatch';
  if (!full.contentType?.startsWith(object.mime)) return 'public_type_mismatch';
  if (!full.cacheControl?.includes('immutable')) return 'public_cache_mismatch';

  if (/^(video|audio)\//.test(object.mime) && source.length > 0) {
    const end = Math.min(RANGE_PROBE_BYTES, source.length) - 1;
    const part = await deps.publicGet(object.key, { start: 0, end });
    if (part.status !== 206 || part.contentRange !== `bytes 0-${end}/${source.length}`) return 'range_not_supported';
  }
  return null;
}

async function attemptCopy(deps: PublicMediaSyncDeps, object: PublicMediaObject): Promise<PublicMediaFailure | null> {
  try {
    return await copyAndVerify(deps, object);
  } catch {
    return 'copy_error';
  }
}

export async function syncPublicMedia(deps: PublicMediaSyncDeps): Promise<PublicMediaSyncReport> {
  const report: PublicMediaSyncReport = { verified: [], failed: [], skipped: [] };
  for (const object of await deps.list()) {
    if (!PUBLIC_MEDIA_KEY_PATTERN.test(object.key)) {
      report.skipped.push(object.key);
      continue;
    }
    const reason = await attemptCopy(deps, object);
    if (reason) report.failed.push({ key: object.key, reason });
    else report.verified.push(object.key);
  }
  return report;
}

/** Where the app records what it has copied. `lib/storage/public-media-ledger.ts` is the real one. */
export interface PublicMediaLedger {
  verifiedKeys(): Promise<ReadonlySet<string>>;
  /** `false` while another run holds the key or it is still backing off. */
  claim(object: PublicMediaObject): Promise<boolean>;
  markVerified(key: string): Promise<void>;
  markFailed(key: string, reason: PublicMediaFailure): Promise<void>;
}

export interface NewPublicMediaReport {
  verified: string[];
  failed: { key: string; reason: PublicMediaFailure }[];
  /** Held by another run or backing off. */
  waiting: string[];
  /** Not started because the budget ran out. The next run takes them. */
  deferred: string[];
}

/**
 * The automatic run: only keys nobody has verified yet, so a run with nothing new reads no file from
 * Supabase. A key becomes verified after `copyAndVerify` passes and not before, which is the whole
 * promise the media host address rests on.
 */
export async function syncNewPublicMedia(
  deps: PublicMediaSyncDeps,
  ledger: PublicMediaLedger,
  options: { stopAt: number; now?: () => number },
): Promise<NewPublicMediaReport> {
  const now = options.now ?? Date.now;
  const report: NewPublicMediaReport = { verified: [], failed: [], waiting: [], deferred: [] };
  const known = await ledger.verifiedKeys();
  for (const object of await deps.list()) {
    if (!PUBLIC_MEDIA_KEY_PATTERN.test(object.key) || known.has(object.key)) continue;
    if (now() >= options.stopAt) {
      report.deferred.push(object.key);
      continue;
    }
    if (!(await ledger.claim(object))) {
      report.waiting.push(object.key);
      continue;
    }
    const reason = await attemptCopy(deps, object);
    if (reason) {
      await ledger.markFailed(object.key, reason);
      report.failed.push({ key: object.key, reason });
    } else {
      await ledger.markVerified(object.key);
      report.verified.push(object.key);
    }
  }
  return report;
}

/**
 * The next `public-media-keys.ts`: the current list plus what this run verified. A run only ever adds.
 * A listed key may be on R2 alone, because its Supabase original can be deleted to free storage. The
 * run cannot see such a key, and dropping it would send the site to an address that answers 404.
 */
export function renderPublicMediaKeys(current: Iterable<string>, verified: readonly string[]): string {
  const lines = [...new Set([...current, ...verified])].sort().map((key) => `  '${key}',`);
  return [
    '// Generated by `npm run r2:sync-public`, which only adds keys.',
    '// Every key here was copied to R2 and read back from the public host byte for byte.',
    '// Its Supabase original may be gone, so removing a key can break the site.',
    'export const PUBLIC_MEDIA_KEYS: ReadonlySet<string> = new Set<string>([',
    ...lines,
    ']);',
    '',
  ].join('\n');
}
