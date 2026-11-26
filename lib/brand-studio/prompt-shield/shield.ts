/**
 * The video prompt shield's server half: whether it is open for an organization, the keys it signs with, and
 * what a job view carries in place of the sent text of a VIDEO run. Image and sound runs never pass through here.
 *
 * Keys: HKDF-SHA-256 over one server-only secret with a fixed label. The secret, in order:
 * `BRAND_STUDIO_PROMPT_TOKEN_SECRET`, then `SUPABASE_SERVICE_ROLE_KEY` (server-only, present wherever the studio
 * runs in the cloud), then — only in local mode and never on Vercel — a fixed local value. With none, the shield
 * stays closed (fail closed = answers as before) and one log line says so; the secret itself is never logged.
 */
import { createHmac, hkdfSync } from 'node:crypto';
import { videoPromptShieldOpenFor } from '@/lib/flags';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import type { StudioJobKind } from '../contracts';
import { promptPageCount } from './layout';

/** The run kinds whose sent text is shielded (a video revision is stored as `video` or `video_remix`). */
export const SHIELDED_KINDS = ['video', 'video_remix', 'video_final'] as const satisfies readonly StudioJobKind[];

export function isShieldedKind(kind: string): boolean {
  return (SHIELDED_KINDS as readonly string[]).includes(kind);
}

export const SHIELD_LABEL = 'twings:video-prompt-shield:v1';
/** Used only when the app runs in local mode off Vercel, so a laptop and the tests need no cloud secret. */
const LOCAL_SECRET = 'twings-local-only:video-prompt-shield:not-a-production-secret';

type Env = Record<string, string | undefined>;

function secretOf(env: Env): string | null {
  const own = env.BRAND_STUDIO_PROMPT_TOKEN_SECRET?.trim();
  if (own && own.length >= 16) return own;
  const service = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (service && service.length >= 16 && !service.startsWith('YOUR-')) return service;
  if (!env.VERCEL && resolveRuntimeMode(env) === 'local') return LOCAL_SECRET;
  return null;
}

let cached: { secret: string; token: Buffer; version: Buffer } | null = null;
let warned = false;

/** The derived keys, or null when no secret is available (the shield then stays closed). */
export function shieldKeys(env: Env = process.env): { token: Buffer; version: Buffer } | null {
  const secret = secretOf(env);
  if (!secret) return null;
  if (cached?.secret !== secret) {
    const derive = (use: string) => Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), `${SHIELD_LABEL}/${use}`, 32));
    cached = { secret, token: derive('token'), version: derive('version') };
  }
  return { token: cached.token, version: cached.version };
}

/**
 * Open for this organization: the switch says so (lib/flags.ts) AND a signing secret exists. A switch that is on
 * with no secret stays closed and says so once in the server log.
 */
export function videoPromptShieldActive(organizationId: string | null | undefined, env: Env = process.env): boolean {
  if (!videoPromptShieldOpenFor(organizationId, env)) return false;
  if (shieldKeys(env)) return true;
  if (!warned) {
    warned = true;
    console.warn(JSON.stringify({ event: 'video_prompt_shield_no_secret', at: new Date().toISOString() }));
  }
  return false;
}

/**
 * A short tag that changes whenever the stored text changes (a cache key for the pictures). Keyed with a server
 * secret, so it cannot be used to test guesses of the text.
 */
export function sentVersion(jobId: string, text: string, env: Env = process.env): string {
  const keys = shieldKeys(env);
  if (!keys) throw new Error('video prompt shield has no key');
  return createHmac('sha256', keys.version).update(jobId).update('\n').update(text).digest('base64url').slice(0, 16);
}

export interface ShieldedSent {
  shielded: true;
  pages: number;
  version: string;
}

/** Page counts by run and version: every state read and poll asks again for the same unchanged runs. */
const pageCounts = new Map<string, number>();
const PAGE_COUNTS_MAX = 2_000;

/** What a view says about a sent text it does not carry. */
export function shieldedSent(jobId: string, text: string, env: Env = process.env): ShieldedSent {
  const version = sentVersion(jobId, text, env);
  const key = `${jobId}:${version}`;
  let pages = pageCounts.get(key);
  if (pages === undefined) {
    pages = promptPageCount(text);
    if (pageCounts.size >= PAGE_COUNTS_MAX) pageCounts.delete(pageCounts.keys().next().value!);
    pageCounts.set(key, pages);
  }
  return { shielded: true, pages, version };
}
