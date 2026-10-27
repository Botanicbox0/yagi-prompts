import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The completion link (docs/TEMPLATES-IA.md §8): `/r/{jobId}/{token}` — opens the finished render
 * with no login, and dies three days after the render finished (founder: "link는 3일내로 expire
 * 되는 느낌으로"). The owner's own page, `/renders/{jobId}`, never expires; the link is a
 * convenience for the inbox, not the record.
 *
 * The token is a random capability stored on the row, not a signed claim: it can be revoked by
 * clearing one column, it needs no secret to verify, and a leaked one names exactly one render.
 * Pure helpers + paths spelled once (the same reason `lib/prompts/links.ts` exists).
 */

export const SHARE_TTL_DAYS = 3;
const SHARE_TOKEN_BYTES = 32;

export const RENDERS_PATH = '/renders';
export const SHARE_REST = '/r';
export const RENDER_MEDIA_REST = '/api/renders/media';

/** 32 random bytes as base64url — 43 characters, URL-safe, no padding. */
export function newShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}

/** The shape a token must have before it is ever compared to a row — a probe is refused cheaply. */
export function isShareTokenShape(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{40,48}$/.test(value);
}

export function shareExpiresAt(finishedAt: Date): Date {
  return new Date(finishedAt.getTime() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function isShareExpired(expiresAt: string | Date | null, now: Date): boolean {
  if (expiresAt === null) return true;
  const at = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  return !Number.isFinite(at) || at <= now.getTime();
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** The owner's page. */
export function renderHref(id: string): string {
  return `${RENDERS_PATH}/${id}`;
}

/** The 3-day link inside the completion message. */
export function shareHref(id: string, token: string): string {
  return `${SHARE_REST}/${id}/${token}`;
}

/**
 * The bytes. `share` carries the token so an inbox (or the share page) can load the preview
 * without a session; `download` asks for `Content-Disposition: attachment`.
 */
/** `poster`: the film's captured frame (0055 `poster_key`) behind the same two doors, never a download. */
/** `frame`: a set's Nth picture (1 = the job's own result), behind the same two doors (`renderFrameParam`). */
export function renderMediaHref(id: string, options: { share?: string; download?: boolean; poster?: boolean; frame?: number } = {}): string {
  const query = new URLSearchParams();
  if (options.share) query.set('s', options.share);
  if (options.frame !== undefined) query.set('frame', String(options.frame));
  if (options.poster) query.set('poster', '1');
  else if (options.download) query.set('download', '1');
  const suffix = query.toString();
  return `${RENDER_MEDIA_REST}/${id}${suffix ? `?${suffix}` : ''}`;
}

/**
 * `?frame=` read back: absent = the result (null), 1–6 = that picture of a set (a recipe makes at most
 * six, lib/recipes/schema.ts), anything else = refused (`'invalid'`) before a row is read.
 */
export function renderFrameParam(value: string | null): number | null | 'invalid' {
  if (value === null) return null;
  return /^[1-6]$/.test(value) ? Number(value) : 'invalid';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRenderId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Which picture the share card (OG image) uses, best first: an image result is its own card; a
 * film uses its captured frame once the owner's browser sent one (0055 `poster_key`); otherwise
 * the template's poster — the closest honest frame there is.
 */
export type ShareImageSource = 'result' | 'frame' | 'template';

export function shareImageSource(resultMime: string | null, posterKey: string | null): ShareImageSource {
  if (resultMime?.startsWith('image/')) return 'result';
  if (posterKey !== null && resultMime?.startsWith('video/')) return 'frame';
  return 'template';
}
