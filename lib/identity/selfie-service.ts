import { createHash, randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { RenderObjectNotFound, type RenderStore } from '@/lib/renders/store';
import { cleanSelfie } from './selfie-images';

/**
 * The saved photos (docs/IDENTITY-SELFIE.md; founder 2026-10-22, PLATFORM-2.0 §4).
 *
 * Natural front-facing photos of the account's OWN face, uploaded once and reused by every order —
 * up to `selfieLimit()` of them (IDENTITY_SELFIE_LIMIT: 1 until the founder approves the terms for
 * more, never above 10). Exactly one active photo is the default, the one the studio offers first
 * ("이 얼굴로 만들까요?"). Nothing is generated from them here: the bytes go to the same engines,
 * through the same consent, provider moderation and (for ModelArk) the same face-asset check.
 *
 * This module owns the rows and the private objects. `savedSelfiePhoto` is the one way a job creator
 * reads the bytes, and it answers only for an ACTIVE photo of the viewer who owns it.
 */
export interface SelfieRow {
  id: string; user_id: string; input_key: string; sha256: string; width: number; height: number;
  consent_at: Date; created_at: Date; replaced_at: Date | null; deleted_at: Date | null;
  is_default: boolean; last_used_at: Date | null; label: string | null;
}
export interface SelfieView {
  id: string; width: number; height: number; createdAt: string; imageUrl: string;
  label: string | null; isDefault: boolean; lastUsedAt: string | null;
}
/** What `GET /api/identity/selfie` answers, and what every screen that lists the photos renders. */
export interface SelfieLibrary { limit: number; defaultId: string | null; items: SelfieView[] }
export interface SelfieDeps { sql: SqlRunner; store: RenderStore; now?: Date; limit?: number }
export type SaveSelfieFailure = 'sign_in_required' | 'consent_required' | 'bad_photo' | 'rate_limited' | 'limit_reached' | 'not_found';
export type SaveSelfieResult = { ok: true; id: string; replaced: boolean; unchanged: boolean } | { ok: false; code: SaveSelfieFailure };
export type ChangeSelfieResult = { ok: true } | { ok: false; code: 'sign_in_required' | 'not_found' | 'invalid' };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clock = (d: { now?: Date }) => d.now ?? new Date();
const ACTIVE = 'deleted_at is null and replaced_at is null';
/** The studio's order: the default, then the photo used last, then the newest. */
const ORDER = 'order by is_default desc, last_used_at desc nulls last, created_at desc, id';
/** Changing faces is cheap for the person and a storage write for us; a day of 20 is plenty. */
export const SELFIE_DAILY_SAVES = 20;
/** The most photos any account may keep, whatever IDENTITY_SELFIE_LIMIT says (PLATFORM-2.0 §4). */
export const SELFIE_LIMIT_MAX = 10;
export const SELFIE_LABEL_MAX = 40;

export const selfieImageHref = (id: string) => `/api/identity/selfie/${id}/image`;
/** Render-store keys are `{uuid}/{name}.{ext}`; the selfie's own id is its folder. */
export const selfieKey = (id: string) => `${id}/selfie.png`;

/**
 * How many active photos an account may keep: IDENTITY_SELFIE_LIMIT as a whole number from 1 to 10.
 * Anything else — unset, empty, zero, a fraction, a word — is 1, the terms' current "one photo".
 */
export function selfieLimit(raw: string | undefined = process.env.IDENTITY_SELFIE_LIMIT): number {
  const value = raw?.trim() ?? '';
  if (!/^\d+$/.test(value)) return 1;
  const n = Number(value);
  return n < 1 ? 1 : Math.min(n, SELFIE_LIMIT_MAX);
}

/** The owner's note: one line, trimmed, at most 40 characters; empty clears it. */
export function normalizeSelfieLabel(raw: unknown): { ok: true; label: string | null } | { ok: false } {
  if (raw === null) return { ok: true, label: null };
  if (typeof raw !== 'string') return { ok: false };
  const label = raw.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!label) return { ok: true, label: null };
  return [...label].length > SELFIE_LABEL_MAX ? { ok: false } : { ok: true, label };
}

export function selfieView(row: Pick<SelfieRow, 'id' | 'width' | 'height' | 'created_at'> & Partial<Pick<SelfieRow, 'label' | 'is_default' | 'last_used_at'>>): SelfieView {
  return {
    id: row.id, width: row.width, height: row.height, createdAt: new Date(row.created_at).toISOString(), imageUrl: selfieImageHref(row.id),
    label: row.label ?? null, isDefault: row.is_default === true, lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  };
}

/** The account's active photos in the studio's order. Never more than SELFIE_LIMIT_MAX can exist. */
export async function listSelfies(sql: SqlRunner, userId: string): Promise<SelfieRow[]> {
  return (await sql.query<SelfieRow>(`select * from identity_selfies where user_id=$1 and ${ACTIVE} ${ORDER} limit ${SELFIE_LIMIT_MAX}`, [userId])).rows;
}

export async function selfieLibrary(sql: SqlRunner, userId: string, limit: number): Promise<SelfieLibrary> {
  const items = (await listSelfies(sql, userId)).map(selfieView);
  return { limit, defaultId: items.find(item => item.isDefault)?.id ?? items[0]?.id ?? null, items };
}

/**
 * The photo the studio offers first: the default (or, should a default ever be missing, the one
 * used last, then the newest). The access call, the account, the brand studio and the community
 * all start from this one.
 */
export async function currentSelfie(sql: SqlRunner, userId: string): Promise<SelfieRow | null> {
  return (await sql.query<SelfieRow>(`select * from identity_selfies where user_id=$1 and ${ACTIVE} ${ORDER} limit 1`, [userId])).rows[0] ?? null;
}

/**
 * Owner-bound read of a photo that was not deleted — active or replaced (the image route needs
 * replaced ones for order history). A deleted photo is gone for its owner too.
 */
export async function ownSelfie(sql: SqlRunner, userId: string, id: string): Promise<SelfieRow | null> {
  if (!uuid.test(id)) return null;
  return (await sql.query<SelfieRow>('select * from identity_selfies where user_id=$1 and id=$2 and deleted_at is null', [userId, id])).rows[0] ?? null;
}

async function activeSelfie(sql: SqlRunner, userId: string, id: string): Promise<SelfieRow | null> {
  if (!uuid.test(id)) return null;
  return (await sql.query<SelfieRow>(`select * from identity_selfies where user_id=$1 and id=$2 and ${ACTIVE}`, [userId, id])).rows[0] ?? null;
}

/** Every change to an account's photos runs under its profile row lock, so two tabs cannot race the limit or the default. */
async function lockOwner(sql: SqlRunner, userId: string): Promise<boolean> {
  return (await sql.query('select id from profiles where id=$1 for update', [userId])).rows.length > 0;
}

/**
 * The same bytes as a photo whose file is gone (two were lost in the 2026-11-12 move to R2) put the
 * file back, so "choose a photo again" also works with the very photo the person still has. A file
 * that is there is left alone; any storage failure other than a missing object still throws.
 */
async function restoreSelfieFile(store: RenderStore, row: SelfieRow, bytes: Uint8Array): Promise<void> {
  try {
    await store.read(row.input_key);
  } catch (error) {
    if (!(error instanceof RenderObjectNotFound)) throw error;
    await store.put(row.input_key, bytes, 'image/png');
    console.warn('[identity] selfie_file_restored', { selfieId: row.id });
  }
}

/**
 * Store a photo. The same bytes as ANY active photo (a double submit, a reload, the same file again)
 * are a no-op that returns that photo (restoring its file if it went missing). `replaceId` swaps one active photo for the new one — the only
 * way in once the library is full — and the new photo inherits its default; otherwise a new photo
 * needs a free slot, and the account's first one becomes the default. The object is written before
 * the row so a crash leaves an orphan file, never a row without bytes.
 */
export async function saveSelfie(d: SelfieDeps, userId: string | null, input: { bytes: Uint8Array; mime: string; consent: boolean; replaceId?: string }): Promise<SaveSelfieResult> {
  if (!userId) return { ok: false, code: 'sign_in_required' };
  if (!input.consent) return { ok: false, code: 'consent_required' };
  if (input.replaceId !== undefined && !uuid.test(input.replaceId)) return { ok: false, code: 'not_found' };
  let clean: Awaited<ReturnType<typeof cleanSelfie>>;
  try { clean = await cleanSelfie(input.bytes, input.mime); } catch { return { ok: false, code: 'bad_photo' }; }
  const sha256 = createHash('sha256').update(clean.bytes).digest('hex');
  const now = clock(d);
  const limit = d.limit ?? selfieLimit();
  const id = randomUUID();
  let written = false;
  return d.sql.transaction(async sql => {
    if (!await lockOwner(sql, userId)) return { ok: false, code: 'sign_in_required' };
    const active = await listSelfies(sql, userId);
    const same = active.find(row => row.sha256 === sha256);
    if (same) {
      await restoreSelfieFile(d.store, same, clean.bytes);
      return { ok: true, id: same.id, replaced: false, unchanged: true };
    }
    const target = input.replaceId === undefined ? null : active.find(row => row.id === input.replaceId) ?? null;
    if (input.replaceId !== undefined && !target) return { ok: false, code: 'not_found' };
    const recent = (await sql.query<{ n: number }>('select count(*)::int n from identity_selfies where user_id=$1 and created_at>$2', [userId, new Date(now.getTime() - 86400000)])).rows[0]?.n ?? 0;
    if (recent >= SELFIE_DAILY_SAVES) return { ok: false, code: 'rate_limited' };
    if (!target && active.length >= limit) return { ok: false, code: 'limit_reached' };
    if (!written) { await d.store.put(selfieKey(id), clean.bytes, 'image/png'); written = true; }
    // Close the old row first: the default index must never see two active defaults.
    if (target) await sql.query('update identity_selfies set replaced_at=$2, is_default=false where id=$1', [target.id, now]);
    const isDefault = target ? target.is_default : !active.some(row => row.is_default);
    await sql.query(`insert into identity_selfies(id,user_id,input_key,sha256,width,height,consent_at,created_at,is_default)
      values($1,$2,$3,$4,$5,$6,$7,$7,$8)`, [id, userId, selfieKey(id), sha256, clean.width, clean.height, now, isDefault]);
    return { ok: true, id, replaced: target !== null, unchanged: false };
  });
}

/** Make an active photo the default and/or set its note. There is always a default, so it is never "unset". */
export async function updateSelfie(d: Pick<SelfieDeps, 'sql' | 'now'>, userId: string | null, input: { id: string; isDefault?: true; label?: string | null }): Promise<ChangeSelfieResult> {
  if (!userId) return { ok: false, code: 'sign_in_required' };
  if (input.isDefault !== undefined && input.isDefault !== true) return { ok: false, code: 'invalid' };
  const label = input.label === undefined ? undefined : normalizeSelfieLabel(input.label);
  if (label && !label.ok) return { ok: false, code: 'invalid' };
  if (input.isDefault === undefined && label === undefined) return { ok: false, code: 'invalid' };
  return d.sql.transaction(async sql => {
    if (!await lockOwner(sql, userId)) return { ok: false, code: 'sign_in_required' };
    const target = await activeSelfie(sql, userId, input.id);
    if (!target) return { ok: false, code: 'not_found' };
    if (input.isDefault && !target.is_default) {
      await sql.query(`update identity_selfies set is_default=false where user_id=$1 and is_default and ${ACTIVE}`, [userId]);
      await sql.query('update identity_selfies set is_default=true where id=$1', [target.id]);
    }
    if (label?.ok) await sql.query('update identity_selfies set label=$2 where id=$1', [target.id, label.label]);
    return { ok: true };
  });
}

/**
 * Soft delete: the row leaves the library and the bytes stay where they are (a paid order may
 * point at them; the account-deletion runbook removes them). Deleting the default hands it to the
 * newest active photo; the last photo may go too, and then the studio asks for a new one.
 */
export async function deleteSelfie(d: Pick<SelfieDeps, 'sql' | 'now'>, userId: string | null, id: string): Promise<ChangeSelfieResult> {
  if (!userId) return { ok: false, code: 'sign_in_required' };
  if (!uuid.test(id)) return { ok: false, code: 'not_found' };
  return d.sql.transaction(async sql => {
    if (!await lockOwner(sql, userId)) return { ok: false, code: 'sign_in_required' };
    const target = await activeSelfie(sql, userId, id);
    if (!target) return { ok: false, code: 'not_found' };
    await sql.query('update identity_selfies set deleted_at=$2, is_default=false where id=$1', [target.id, clock(d)]);
    if (target.is_default) {
      await sql.query(`update identity_selfies set is_default=true where id=(
        select id from identity_selfies where user_id=$1 and ${ACTIVE} order by created_at desc, id limit 1)`, [userId]);
    }
    return { ok: true };
  });
}

/**
 * The bytes a job creator copies into its own input object, from ANY active photo of the viewer
 * who owns it — default or not. A photo replaced or deleted (perhaps in another tab) answers null,
 * so it is never bought a second later; a stranger's id is simply not found. Reading for an order
 * is what "used" means: `last_used_at` moves (inside the caller's transaction, when there is one).
 * Paid jobs keep their own copy, so a later replacement or deletion never touches them.
 *
 * A live row whose file is gone from the render store (two were lost in the 2026-11-12 move to R2)
 * answers `selfie_file_missing`, so the order routes ask for a photo again before anything is
 * created. Only a missing object is caught: a credentials or bucket failure still throws.
 */
export type SavedSelfieRead =
  | { ok: true; photo: { bytes: Uint8Array; mime: 'image/png' } }
  | { ok: false; code: 'selfie_required' | 'selfie_file_missing' };
export async function readSavedSelfie(sql: SqlRunner, store: RenderStore, userId: string, id: string, now: Date = new Date()): Promise<SavedSelfieRead> {
  const row = await activeSelfie(sql, userId, id);
  if (!row) return { ok: false, code: 'selfie_required' };
  let bytes: Uint8Array;
  try {
    bytes = await store.read(row.input_key);
  } catch (error) {
    if (!(error instanceof RenderObjectNotFound)) throw error;
    console.warn('[identity] selfie_file_missing', { selfieId: row.id });
    return { ok: false, code: 'selfie_file_missing' };
  }
  await sql.query('update identity_selfies set last_used_at=$3 where id=$1 and user_id=$2', [row.id, userId, now]);
  return { ok: true, photo: { bytes, mime: 'image/png' } };
}

/** `readSavedSelfie` for the job creators that only need the bytes: null when there is no usable photo (a missing file included). */
export async function savedSelfiePhoto(sql: SqlRunner, store: RenderStore, userId: string, id: string, now: Date = new Date()): Promise<{ bytes: Uint8Array; mime: 'image/png' } | null> {
  const read = await readSavedSelfie(sql, store, userId, id, now);
  return read.ok ? read.photo : null;
}

/**
 * The same rule for a new order that already holds the bytes (다시 결제하기 copies the failed order's
 * input): the photo must still be an ACTIVE photo of its owner. Stamps `last_used_at` in the same
 * statement; false for a replaced, deleted or foreign id, so the caller answers `selfie_required`.
 */
export async function useSavedSelfie(sql: SqlRunner, userId: string, id: string, now: Date = new Date()): Promise<boolean> {
  if (!uuid.test(id)) return false;
  return (await sql.query(`update identity_selfies set last_used_at=$3 where id=$1 and user_id=$2 and ${ACTIVE} returning id`, [id, userId, now])).rows.length > 0;
}
