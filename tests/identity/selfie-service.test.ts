import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { billingDb, seedProfile, USER, type BillingHarness } from '@/tests/helpers/billing';
import type { RenderStore } from '@/lib/renders/store';
import { currentSelfie, ownSelfie, saveSelfie, savedSelfiePhoto, selfieKey, selfieView, SELFIE_DAILY_SAVES, type SelfieDeps } from '@/lib/identity/selfie-service';
import { cleanSelfie } from '@/lib/identity/selfie-images';

/**
 * docs/IDENTITY-SELFIE.md — one current selfie per account, replaced in place, read only by its
 * owner, and never resolved for a new order once replaced. No generation, no provider call.
 */
describe('the saved selfie', () => {
  let h: BillingHarness, d: SelfieDeps, objects: Map<string, Uint8Array>;
  const picture = async (color: string, width = 320, height = 400) => new Uint8Array(await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer());
  const store = (): RenderStore => ({ name: 'local', put: async (k, b) => { objects.set(k, b); }, read: async k => { const b = objects.get(k); if (!b) throw Error('missing'); return b; }, url: async () => null });
  beforeEach(async () => {
    h = await billingDb();
    await seedProfile(h.sql, { id: USER.buyer });
    await seedProfile(h.sql, { id: USER.other });
    objects = new Map();
    d = { sql: h.sql, store: store(), now: new Date('2026-10-22T09:00:00Z') };
  });
  afterEach(async () => h.close());

  it('requires a session, consent and a decodable photo, then stores EXIF-free PNG bytes under the row', async () => {
    const bytes = await picture('#d6d6d6');
    expect(await saveSelfie(d, null, { bytes, mime: 'image/png', consent: true })).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await saveSelfie(d, USER.buyer, { bytes, mime: 'image/png', consent: false })).toEqual({ ok: false, code: 'consent_required' });
    expect(await saveSelfie(d, USER.buyer, { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', consent: true })).toEqual({ ok: false, code: 'bad_photo' });
    expect(await saveSelfie(d, USER.buyer, { bytes, mime: 'image/gif', consent: true })).toEqual({ ok: false, code: 'bad_photo' });
    expect(await saveSelfie(d, USER.buyer, { bytes: await picture('#fff', 100, 100), mime: 'image/png', consent: true })).toEqual({ ok: false, code: 'bad_photo' });
    expect(await currentSelfie(h.sql, USER.buyer)).toBeNull();
    const saved = await saveSelfie(d, USER.buyer, { bytes, mime: 'image/png', consent: true });
    expect(saved).toMatchObject({ ok: true, replaced: false, unchanged: false });
    if (!saved.ok) throw Error(saved.code);
    const row = await currentSelfie(h.sql, USER.buyer);
    expect(row).toMatchObject({ id: saved.id, width: 320, height: 400, replaced_at: null, input_key: selfieKey(saved.id) });
    expect(objects.has(selfieKey(saved.id))).toBe(true);
    expect(await sharp(objects.get(selfieKey(saved.id))!).metadata()).toMatchObject({ format: 'png', width: 320, height: 400 });
    expect(selfieView(row!)).toEqual({ id: saved.id, width: 320, height: 400, createdAt: '2026-10-22T09:00:00.000Z', imageUrl: `/api/identity/selfie/${saved.id}/image` });
  });

  it('is idempotent for the same bytes and replaces in place for new bytes, keeping the old row for lineage', async () => {
    const first = await saveSelfie(d, USER.buyer, { bytes: await picture('#d6d6d6'), mime: 'image/png', consent: true });
    if (!first.ok) throw Error(first.code);
    const again = await saveSelfie(d, USER.buyer, { bytes: await picture('#d6d6d6'), mime: 'image/png', consent: true });
    expect(again).toEqual({ ok: true, id: first.id, replaced: false, unchanged: true });
    const second = await saveSelfie({ ...d, now: new Date('2026-10-22T10:00:00Z') }, USER.buyer, { bytes: await picture('#a0a0a0'), mime: 'image/png', consent: true });
    expect(second).toMatchObject({ ok: true, replaced: true, unchanged: false });
    if (!second.ok) throw Error(second.code);
    expect((await currentSelfie(h.sql, USER.buyer))?.id).toBe(second.id);
    expect((await ownSelfie(h.sql, USER.buyer, first.id))?.replaced_at).toEqual(new Date('2026-10-22T10:00:00Z'));
    expect((await h.sql.query('select count(*)::int n from identity_selfies where user_id=$1', [USER.buyer])).rows[0]).toEqual({ n: 2 });
    // The old bytes stay for paid jobs that reference them; a NEW order may only use the current one.
    expect(await savedSelfiePhoto(h.sql, d.store, USER.buyer, first.id)).toBeNull();
    expect((await savedSelfiePhoto(h.sql, d.store, USER.buyer, second.id))?.mime).toBe('image/png');
  });

  it('answers only for the owner, and never for a stranger, a garbage id or an unknown id', async () => {
    const saved = await saveSelfie(d, USER.buyer, { bytes: await picture('#d6d6d6'), mime: 'image/png', consent: true });
    if (!saved.ok) throw Error(saved.code);
    expect(await savedSelfiePhoto(h.sql, d.store, USER.other, saved.id)).toBeNull();
    expect(await ownSelfie(h.sql, USER.other, saved.id)).toBeNull();
    expect(await ownSelfie(h.sql, USER.buyer, 'not-a-uuid')).toBeNull();
    expect(await savedSelfiePhoto(h.sql, d.store, USER.buyer, '00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await currentSelfie(h.sql, USER.other)).toBeNull();
  });

  it('bounds replacements per day without touching the current selfie', async () => {
    for (let i = 0; i < SELFIE_DAILY_SAVES; i++) {
      const r = await saveSelfie(d, USER.buyer, { bytes: await picture(`#${(0x101010 + i * 0x010101).toString(16).padStart(6, '0')}`), mime: 'image/png', consent: true });
      expect(r.ok).toBe(true);
    }
    const current = await currentSelfie(h.sql, USER.buyer);
    expect(await saveSelfie(d, USER.buyer, { bytes: await picture('#ffffff'), mime: 'image/png', consent: true })).toEqual({ ok: false, code: 'rate_limited' });
    expect((await currentSelfie(h.sql, USER.buyer))?.id).toBe(current?.id);
    // A day later the person may change it again.
    expect((await saveSelfie({ ...d, now: new Date('2026-10-23T09:00:01Z') }, USER.buyer, { bytes: await picture('#ffffff'), mime: 'image/png', consent: true })).ok).toBe(true);
  });

  it('one current selfie per account is enforced by the schema, not only by the service', async () => {
    const saved = await saveSelfie(d, USER.buyer, { bytes: await picture('#d6d6d6'), mime: 'image/png', consent: true });
    if (!saved.ok) throw Error(saved.code);
    await expect(h.sql.query(`insert into identity_selfies(id,user_id,input_key,sha256,width,height,consent_at) values(gen_random_uuid(),$1,'x','${'b'.repeat(64)}',10,10,now())`, [USER.buyer])).rejects.toThrow(/identity_selfie_current/);
  });

  it('cleans the selfie: orientation applied, metadata dropped, no upscaling, downscaled to 1600px', async () => {
    const big = new Uint8Array(await sharp({ create: { width: 2400, height: 3000, channels: 3, background: '#808080' } }).jpeg().toBuffer());
    const clean = await cleanSelfie(big, 'image/jpeg');
    expect(clean).toMatchObject({ width: 1280, height: 1600 });
    const meta = await sharp(clean.bytes).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 1280, height: 1600 });
    expect(meta.exif).toBeUndefined();
    const small = await cleanSelfie(await picture('#eee', 300, 300), 'image/png');
    expect(small).toMatchObject({ width: 300, height: 300 });
  });
});
