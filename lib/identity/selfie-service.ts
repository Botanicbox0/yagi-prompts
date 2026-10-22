import { createHash, randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RenderStore } from '@/lib/renders/store';
import { cleanSelfie } from './selfie-images';

/**
 * The saved selfie (docs/IDENTITY-SELFIE.md, founder 2026-10-22).
 *
 * One natural front-facing photo per account, uploaded once and reused by every order until the
 * person replaces it. Nothing is generated from it here: the bytes go to the same engines, through
 * the same consent, provider moderation and (for ModelArk) the same face-asset check as before.
 * This module only owns the row and the private object; `savedSelfiePhoto` is the one way a job
 * creator reads the bytes, and it answers only for the CURRENT selfie of the viewer who owns it.
 */
export interface SelfieRow {
  id: string; user_id: string; input_key: string; sha256: string; width: number; height: number;
  consent_at: Date; created_at: Date; replaced_at: Date | null;
}
export interface SelfieView { id: string; width: number; height: number; createdAt: string; imageUrl: string }
export interface SelfieDeps { sql: SqlRunner; store: RenderStore; now?: Date }
export type SaveSelfieFailure = 'sign_in_required' | 'consent_required' | 'bad_photo' | 'rate_limited';
export type SaveSelfieResult = { ok: true; id: string; replaced: boolean; unchanged: boolean } | { ok: false; code: SaveSelfieFailure };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clock = (d: { now?: Date }) => d.now ?? new Date();
/** Replacing a face is cheap for the person and a storage write for us; a day of 20 is plenty. */
export const SELFIE_DAILY_SAVES = 20;

export const selfieImageHref = (id: string) => `/api/identity/selfie/${id}/image`;
/** Render-store keys are `{uuid}/{name}.{ext}`; the selfie's own id is its folder. */
export const selfieKey = (id: string) => `${id}/selfie.png`;

export function selfieView(row: Pick<SelfieRow, 'id' | 'width' | 'height' | 'created_at'>): SelfieView {
  return { id: row.id, width: row.width, height: row.height, createdAt: new Date(row.created_at).toISOString(), imageUrl: selfieImageHref(row.id) };
}

export async function currentSelfie(sql: SqlRunner, userId: string): Promise<SelfieRow | null> {
  return (await sql.query<SelfieRow>('select * from identity_selfies where user_id=$1 and replaced_at is null', [userId])).rows[0] ?? null;
}

/** Owner-bound read of any selfie row (current or replaced) — the image route needs replaced ones for order history. */
export async function ownSelfie(sql: SqlRunner, userId: string, id: string): Promise<SelfieRow | null> {
  if (!uuid.test(id)) return null;
  return (await sql.query<SelfieRow>('select * from identity_selfies where user_id=$1 and id=$2', [userId, id])).rows[0] ?? null;
}

/**
 * Store a new current selfie. The same bytes again (a double submit, a reload) are a no-op that
 * returns the existing id; different bytes close the previous row and open a new one. The object is
 * written before the row so a crash leaves an orphan file, never a row without bytes.
 */
export async function saveSelfie(d: SelfieDeps, userId: string | null, input: { bytes: Uint8Array; mime: string; consent: boolean }): Promise<SaveSelfieResult> {
  if (!userId) return { ok: false, code: 'sign_in_required' };
  if (!input.consent) return { ok: false, code: 'consent_required' };
  let clean: Awaited<ReturnType<typeof cleanSelfie>>;
  try { clean = await cleanSelfie(input.bytes, input.mime); } catch { return { ok: false, code: 'bad_photo' }; }
  const sha256 = createHash('sha256').update(clean.bytes).digest('hex');
  const now = clock(d);
  const id = randomUUID();
  let written = false;
  return d.sql.transaction(async sql => {
    const owner = await sql.query('select id from profiles where id=$1 for update', [userId]);
    if (!owner.rows.length) return { ok: false, code: 'sign_in_required' };
    const current = await currentSelfie(sql, userId);
    if (current && current.sha256 === sha256) return { ok: true, id: current.id, replaced: false, unchanged: true };
    const recent = (await sql.query<{ n: number }>('select count(*)::int n from identity_selfies where user_id=$1 and created_at>$2', [userId, new Date(now.getTime() - 86400000)])).rows[0]?.n ?? 0;
    if (recent >= SELFIE_DAILY_SAVES) return { ok: false, code: 'rate_limited' };
    if (!written) { await d.store.put(selfieKey(id), clean.bytes, 'image/png'); written = true; }
    if (current) await sql.query('update identity_selfies set replaced_at=$2 where id=$1', [current.id, now]);
    await sql.query(`insert into identity_selfies(id,user_id,input_key,sha256,width,height,consent_at,created_at)
      values($1,$2,$3,$4,$5,$6,$7,$7)`, [id, userId, selfieKey(id), sha256, clean.width, clean.height, now]);
    return { ok: true, id, replaced: current !== null, unchanged: false };
  });
}

/**
 * The bytes a job creator copies into its own input object. Only the viewer's CURRENT selfie
 * answers: a selfie replaced in another tab must not be bought a second later, and a stranger's
 * id is simply not found. Paid jobs keep their own copy, so later replacement never touches them.
 */
export async function savedSelfiePhoto(sql: SqlRunner, store: RenderStore, userId: string, id: string): Promise<{ bytes: Uint8Array; mime: 'image/png' } | null> {
  const row = await ownSelfie(sql, userId, id);
  if (!row || row.replaced_at !== null) return null;
  return { bytes: await store.read(row.input_key), mime: 'image/png' };
}
