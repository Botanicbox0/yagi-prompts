/**
 * The designed-sentence token of the video prompt shield: `prompt.enhance` hands the screen this instead of the
 * text, the screen hands it back to `job.create` (`reviewedToken`) and to the picture route. Self-contained, no
 * table: AES-256-GCM over `{ v, org, user, model, kind, prompt, iat }`, base64url, keyed from ./shield.ts.
 *
 * Every refusal is the same `null`: a forged, altered, expired, oversized or foreign token is told apart from
 * nothing. Nothing here logs the token or what is inside it.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { SHIELD_LABEL, shieldKeys } from './shield';

const FORMAT = 1;
const IV = 12;
const TAG = 16;
export const PROMPT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** Longest sentence a token may carry (Seedance 2.5 takes up to 15,000 characters per clip). */
export const PROMPT_TOKEN_TEXT_MAX = 15_000;
/** The longest token a 15,000-character sentence can produce (every character escaped to six bytes, plus the rest). */
export const PROMPT_TOKEN_MAX = Math.ceil(((1 + IV + TAG + PROMPT_TOKEN_TEXT_MAX * 6 + 1024) * 4) / 3);

export interface PromptTokenClaims {
  org: string;
  user: string;
  model: string;
  kind: string;
}

type Env = Record<string, string | undefined>;
const AAD = Buffer.from(SHIELD_LABEL);

/** A token for `prompt`, or null when the shield has no key (it is then closed and never asks for one). */
export function sealPromptToken(claims: PromptTokenClaims & { prompt: string }, env: Env = process.env, now = Date.now()): string | null {
  const keys = shieldKeys(env);
  if (!keys || claims.prompt.length > PROMPT_TOKEN_TEXT_MAX) return null;
  const body = Buffer.from(
    JSON.stringify({ v: FORMAT, org: claims.org, user: claims.user, model: claims.model, kind: claims.kind, prompt: claims.prompt, iat: Math.floor(now / 1000) }),
  );
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', keys.token, iv);
  cipher.setAAD(AAD);
  const sealed = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT]), iv, sealed, cipher.getAuthTag()]).toString('base64url');
}

/**
 * What a token must have been made for. `model: null` takes any model and `kind` may list several (the picture
 * route, which only shows the sentence to the member who designed it).
 */
export interface PromptTokenExpect {
  org: string;
  user: string;
  model: string | null;
  kind: string | readonly string[];
}

/** The sentence inside `token` when it was made for these claims within the last 24 hours; else null. */
export function openPromptToken(token: unknown, expect: PromptTokenExpect, env: Env = process.env, now = Date.now()): string | null {
  if (typeof token !== 'string' || token.length < 40 || token.length > PROMPT_TOKEN_MAX || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const keys = shieldKeys(env);
  if (!keys) return null;
  try {
    const raw = Buffer.from(token, 'base64url');
    if (raw[0] !== FORMAT || raw.length < 1 + IV + TAG + 2) return null;
    const decipher = createDecipheriv('aes-256-gcm', keys.token, raw.subarray(1, 1 + IV));
    decipher.setAAD(AAD);
    decipher.setAuthTag(raw.subarray(raw.length - TAG));
    const body = Buffer.concat([decipher.update(raw.subarray(1 + IV, raw.length - TAG)), decipher.final()]);
    const c = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    if (c.v !== FORMAT || typeof c.prompt !== 'string' || typeof c.iat !== 'number') return null;
    const kinds: readonly string[] = typeof expect.kind === 'string' ? [expect.kind] : expect.kind;
    if (c.org !== expect.org || c.user !== expect.user || typeof c.kind !== 'string' || !kinds.includes(c.kind)) return null;
    if (expect.model !== null && c.model !== expect.model) return null;
    const age = now - c.iat * 1000;
    if (age < -5 * 60 * 1000 || age > PROMPT_TOKEN_TTL_MS) return null;
    if (c.prompt.length > PROMPT_TOKEN_TEXT_MAX) return null;
    return c.prompt;
  } catch {
    return null;
  }
}
