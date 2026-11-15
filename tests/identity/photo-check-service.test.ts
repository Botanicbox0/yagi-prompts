import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { billingDb, seedProfile, USER, type BillingHarness } from '@/tests/helpers/billing';
import type { RenderStore } from '@/lib/renders/store';
import { deleteSelfie, saveSelfie, type SelfieDeps } from '@/lib/identity/selfie-service';
import { photoCheckSchemaReady, selfiePhotoCheck } from '@/lib/identity/photo-check-service';
import type { PhotoCheck } from '@/lib/identity/photo-check-view';

/** 0089 — one advisory check per saved photo, owner only, stored once, never stored when it failed. */
describe('saved photo check', () => {
  let h: BillingHarness, objects: Map<string, Uint8Array>;
  const store = (): RenderStore => ({ name: 'local', put: async (k, b) => { objects.set(k, b); }, read: async k => { const b = objects.get(k); if (!b) throw Error('missing'); return b; }, url: async () => null });
  const picture = async (color: string) => new Uint8Array(await sharp({ create: { width: 320, height: 400, channels: 3, background: color } }).png().toBuffer());
  const save = async (color: string, over: Partial<SelfieDeps> = {}) => {
    const result = await saveSelfie({ sql: h.sql, store: store(), limit: 3, ...over }, USER.buyer, { bytes: await picture(color), mime: 'image/png', consent: true });
    if (!result.ok) throw Error(result.code);
    return result.id;
  };
  const RETAKE: PhotoCheck = { status: 'retake', issues: ['blurry', 'dark'] };
  const stored = async (id: string) => (await h.sql.query<{ photo_check: unknown; photo_checked_at: Date | null; last_used_at: Date | null }>('select photo_check, photo_checked_at, last_used_at from identity_selfies where id=$1', [id])).rows[0];

  beforeEach(async () => {
    h = await billingDb();
    await seedProfile(h.sql, { id: USER.buyer });
    await seedProfile(h.sql, { id: USER.other });
    objects = new Map();
  });
  afterEach(async () => h.close());

  it('sees the 0089 columns', async () => {
    expect(await photoCheckSchemaReady(h.sql)).toBe(true);
  });

  it('runs once for the owner, stores the verdict, and reads it back without calling again', async () => {
    const id = await save('#d6d6d6');
    const check = vi.fn(async (_bytes: Uint8Array) => RETAKE);
    const at = new Date('2026-11-15T09:00:00Z');
    expect(await selfiePhotoCheck({ sql: h.sql, store: store(), check, now: at }, USER.buyer, id)).toEqual({ ok: true, check: RETAKE });
    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0]![0]).toEqual(objects.get(`${id}/selfie.png`));
    expect(await stored(id)).toEqual({ photo_check: RETAKE, photo_checked_at: at, last_used_at: null });
    expect(await selfiePhotoCheck({ sql: h.sql, store: store(), check }, USER.buyer, id)).toEqual({ ok: true, check: RETAKE });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('answers only for an active photo of its owner', async () => {
    const id = await save('#d6d6d6');
    const check = vi.fn(async (): Promise<PhotoCheck> => ({ status: 'good', issues: [] }));
    const d = { sql: h.sql, store: store(), check };
    expect(await selfiePhotoCheck(d, USER.other, id)).toEqual({ ok: false, code: 'not_found' });
    expect(await selfiePhotoCheck(d, USER.buyer, 'not-a-uuid')).toEqual({ ok: false, code: 'not_found' });
    expect(await selfiePhotoCheck(d, USER.buyer, '00000000-0000-4000-8000-000000000000')).toEqual({ ok: false, code: 'not_found' });
    // Replaced, then deleted: neither is checked any more.
    const next = await saveSelfie({ sql: h.sql, store: store(), limit: 1 }, USER.buyer, { bytes: await picture('#a0a0a0'), mime: 'image/png', consent: true, replaceId: id });
    if (!next.ok) throw Error(next.code);
    expect(await selfiePhotoCheck(d, USER.buyer, id)).toEqual({ ok: false, code: 'not_found' });
    expect(await deleteSelfie({ sql: h.sql }, USER.buyer, next.id)).toEqual({ ok: true });
    expect(await selfiePhotoCheck(d, USER.buyer, next.id)).toEqual({ ok: false, code: 'not_found' });
    expect(check).not.toHaveBeenCalled();
  });

  it('does not store a failed check, so a later visit may ask again', async () => {
    const id = await save('#d6d6d6');
    const failing = vi.fn(async () => null);
    expect(await selfiePhotoCheck({ sql: h.sql, store: store(), check: failing }, USER.buyer, id)).toEqual({ ok: true, check: null });
    expect(await stored(id)).toMatchObject({ photo_check: null, photo_checked_at: null });
    const working = vi.fn(async (): Promise<PhotoCheck> => ({ status: 'check', issues: ['side_angle'] }));
    expect(await selfiePhotoCheck({ sql: h.sql, store: store(), check: working }, USER.buyer, id)).toEqual({ ok: true, check: { status: 'check', issues: ['side_angle'] } });
    expect(working).toHaveBeenCalledTimes(1);
  });

  it('a missing photo file is no result, not an error', async () => {
    const id = await save('#d6d6d6');
    objects.clear();
    const check = vi.fn(async (): Promise<PhotoCheck> => ({ status: 'good', issues: [] }));
    expect(await selfiePhotoCheck({ sql: h.sql, store: store(), check }, USER.buyer, id)).toEqual({ ok: true, check: null });
    expect(check).not.toHaveBeenCalled();
  });

  it('off (no checker) never reads a row or calls anything', async () => {
    const id = await save('#d6d6d6');
    const query = vi.spyOn(h.sql, 'query');
    expect(await selfiePhotoCheck({ sql: h.sql, store: store(), check: null }, USER.buyer, id)).toEqual({ ok: false, code: 'off' });
    expect(query).not.toHaveBeenCalled();
  });

  it('stays off before 0089 is applied', async () => {
    const id = await save('#d6d6d6');
    await h.sql.query('alter table identity_selfies drop column photo_check cascade, drop column photo_checked_at cascade');
    expect(await photoCheckSchemaReady(h.sql)).toBe(false);
    const check = vi.fn(async (): Promise<PhotoCheck> => ({ status: 'good', issues: [] }));
    expect(await selfiePhotoCheck({ sql: h.sql, store: store(), check }, USER.buyer, id)).toEqual({ ok: false, code: 'off' });
    expect(check).not.toHaveBeenCalled();
  });

  it('the schema keeps only a verdict-shaped value, stamped together with its time', async () => {
    const id = await save('#d6d6d6');
    await expect(h.sql.query(`update identity_selfies set photo_check='{"status":"great","issues":[]}', photo_checked_at=now() where id=$1`, [id])).rejects.toThrow(/photo_check_shape/);
    await expect(h.sql.query(`update identity_selfies set photo_check='{"status":"good","issues":[]}' where id=$1`, [id])).rejects.toThrow(/photo_check_stamped/);
  });
});
