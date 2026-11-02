import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { billingDb, seedProfile, USER, type BillingHarness } from '@/tests/helpers/billing';
import type { RenderStore } from '@/lib/renders/store';
import {
  currentSelfie, deleteSelfie, listSelfies, normalizeSelfieLabel, ownSelfie, saveSelfie, savedSelfiePhoto, selfieKey, selfieLibrary,
  selfieLimit, selfieView, SELFIE_DAILY_SAVES, SELFIE_LIMIT_MAX, updateSelfie, type SelfieDeps,
} from '@/lib/identity/selfie-service';
import { cleanSelfie } from '@/lib/identity/selfie-images';

/**
 * docs/IDENTITY-SELFIE.md §4 — up to N photos of the same person (N = IDENTITY_SELFIE_LIMIT, default
 * 1, at most 10), exactly one default among the active ones, read only by their owner, soft-deleted,
 * and never resolved for a new order once replaced or deleted. No generation, no provider call.
 */
describe('the saved photo library', () => {
  let h: BillingHarness, objects: Map<string, Uint8Array>;
  const at = (iso: string) => new Date(iso);
  const picture = async (color: string, width = 320, height = 400) => new Uint8Array(await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer());
  const store = (): RenderStore => ({ name: 'local', put: async (k, b) => { objects.set(k, b); }, read: async k => { const b = objects.get(k); if (!b) throw Error('missing'); return b; }, url: async () => null });
  const deps = (over: Partial<SelfieDeps> = {}): SelfieDeps => ({ sql: h.sql, store: store(), now: at('2026-10-22T09:00:00Z'), limit: 1, ...over });
  const save = async (color: string, over: Partial<SelfieDeps> = {}, replaceId?: string) => {
    const result = await saveSelfie(deps(over), USER.buyer, { bytes: await picture(color), mime: 'image/png', consent: true, ...(replaceId ? { replaceId } : {}) });
    if (!result.ok) throw Error(result.code);
    return result;
  };
  const defaults = async (userId = USER.buyer) => (await h.sql.query<{ id: string }>('select id from identity_selfies where user_id=$1 and is_default and deleted_at is null and replaced_at is null', [userId])).rows.map(row => row.id);
  beforeEach(async () => {
    h = await billingDb();
    await seedProfile(h.sql, { id: USER.buyer });
    await seedProfile(h.sql, { id: USER.other });
    objects = new Map();
  });
  afterEach(async () => h.close());

  it('reads the limit from IDENTITY_SELFIE_LIMIT: a whole number, 1 by default, never above 10', () => {
    expect(selfieLimit(undefined)).toBe(1);
    expect(selfieLimit('')).toBe(1);
    expect(selfieLimit('10')).toBe(10);
    expect(selfieLimit(' 4 ')).toBe(4);
    expect(selfieLimit('11')).toBe(SELFIE_LIMIT_MAX);
    expect(selfieLimit('500')).toBe(10);
    for (const odd of ['0', '-3', '2.5', 'ten', '1e1', 'NaN']) expect(selfieLimit(odd)).toBe(1);
  });

  it('requires a session, consent and a decodable photo, then stores EXIF-free PNG bytes as the default', async () => {
    const bytes = await picture('#d6d6d6');
    const d = deps();
    expect(await saveSelfie(d, null, { bytes, mime: 'image/png', consent: true })).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await saveSelfie(d, USER.buyer, { bytes, mime: 'image/png', consent: false })).toEqual({ ok: false, code: 'consent_required' });
    expect(await saveSelfie(d, USER.buyer, { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', consent: true })).toEqual({ ok: false, code: 'bad_photo' });
    expect(await saveSelfie(d, USER.buyer, { bytes, mime: 'image/gif', consent: true })).toEqual({ ok: false, code: 'bad_photo' });
    expect(await saveSelfie(d, USER.buyer, { bytes: await picture('#fff', 100, 100), mime: 'image/png', consent: true })).toEqual({ ok: false, code: 'bad_photo' });
    expect(await currentSelfie(h.sql, USER.buyer)).toBeNull();
    expect(objects.size).toBe(0);
    const saved = await saveSelfie(d, USER.buyer, { bytes, mime: 'image/png', consent: true });
    expect(saved).toMatchObject({ ok: true, replaced: false, unchanged: false });
    if (!saved.ok) throw Error(saved.code);
    const row = await currentSelfie(h.sql, USER.buyer);
    expect(row).toMatchObject({ id: saved.id, width: 320, height: 400, replaced_at: null, deleted_at: null, is_default: true, last_used_at: null, label: null, input_key: selfieKey(saved.id) });
    expect(await sharp(objects.get(selfieKey(saved.id))!).metadata()).toMatchObject({ format: 'png', width: 320, height: 400 });
    expect(selfieView(row!)).toEqual({
      id: saved.id, width: 320, height: 400, createdAt: '2026-10-22T09:00:00.000Z', imageUrl: `/api/identity/selfie/${saved.id}/image`,
      label: null, isDefault: true, lastUsedAt: null,
    });
  });

  it('N=1: a second photo needs "replace"; the same bytes are a no-op; replacing keeps the old row for lineage', async () => {
    const first = await save('#d6d6d6');
    expect(await saveSelfie(deps(), USER.buyer, { bytes: await picture('#d6d6d6'), mime: 'image/png', consent: true })).toEqual({ ok: true, id: first.id, replaced: false, unchanged: true });
    expect(await saveSelfie(deps(), USER.buyer, { bytes: await picture('#a0a0a0'), mime: 'image/png', consent: true })).toEqual({ ok: false, code: 'limit_reached' });
    const second = await save('#a0a0a0', { now: at('2026-10-22T10:00:00Z') }, first.id);
    expect(second).toMatchObject({ replaced: true, unchanged: false });
    expect((await currentSelfie(h.sql, USER.buyer))).toMatchObject({ id: second.id, is_default: true });
    expect(await ownSelfie(h.sql, USER.buyer, first.id)).toMatchObject({ replaced_at: at('2026-10-22T10:00:00Z'), is_default: false });
    expect((await h.sql.query('select count(*)::int n from identity_selfies where user_id=$1', [USER.buyer])).rows[0]).toEqual({ n: 2 });
    expect(await defaults()).toEqual([second.id]);
    // The old bytes stay for paid jobs that reference them; a NEW order may only use an active photo.
    expect(await savedSelfiePhoto(h.sql, store(), USER.buyer, first.id)).toBeNull();
    expect((await savedSelfiePhoto(h.sql, store(), USER.buyer, second.id))?.mime).toBe('image/png');
    expect(await selfieLibrary(h.sql, USER.buyer, 1)).toMatchObject({ limit: 1, defaultId: second.id, items: [{ id: second.id, isDefault: true }] });
  });

  it('keeps up to N photos, refuses the N+1th, and finds a duplicate anywhere in the library', async () => {
    const d = { limit: 3 };
    const a = await save('#d6d6d6', d);
    const b = await save('#a0a0a0', { ...d, now: at('2026-10-22T09:05:00Z') });
    const c = await save('#707070', { ...d, now: at('2026-10-22T09:10:00Z') });
    expect([a, b, c].map(r => r.replaced)).toEqual([false, false, false]);
    expect(await saveSelfie(deps(d), USER.buyer, { bytes: await picture('#404040'), mime: 'image/png', consent: true })).toEqual({ ok: false, code: 'limit_reached' });
    // The same bytes as ANY active photo — not only the default — return that photo, even at the limit.
    expect(await saveSelfie(deps(d), USER.buyer, { bytes: await picture('#a0a0a0'), mime: 'image/png', consent: true })).toEqual({ ok: true, id: b.id, replaced: false, unchanged: true });
    expect(await defaults()).toEqual([a.id]);
    const library = await selfieLibrary(h.sql, USER.buyer, 3);
    expect(library.limit).toBe(3);
    expect(library.defaultId).toBe(a.id);
    // Default first, then the newest; every item carries what the grid needs and nothing else.
    expect(library.items.map(item => item.id)).toEqual([a.id, c.id, b.id]);
    expect(Object.keys(library.items[0]!).sort()).toEqual(['createdAt', 'height', 'id', 'imageUrl', 'isDefault', 'label', 'lastUsedAt', 'width']);
    // Replacing a non-default photo at the limit keeps the default where it was.
    const d2 = await save('#202020', { ...d, now: at('2026-10-22T09:20:00Z') }, c.id);
    expect(await defaults()).toEqual([a.id]);
    expect((await listSelfies(h.sql, USER.buyer)).map(row => row.id)).toEqual([a.id, d2.id, b.id]);
  });

  it('exactly one default among the active photos: moved by the owner, enforced by the schema', async () => {
    const d = { limit: 3 };
    const a = await save('#d6d6d6', d);
    const b = await save('#a0a0a0', d);
    expect(await updateSelfie(deps(d), USER.buyer, { id: b.id, isDefault: true })).toEqual({ ok: true });
    expect(await defaults()).toEqual([b.id]);
    expect((await currentSelfie(h.sql, USER.buyer))?.id).toBe(b.id);
    // Asking again is harmless; "un-defaulting" is not a thing (there is always one).
    expect(await updateSelfie(deps(d), USER.buyer, { id: b.id, isDefault: true })).toEqual({ ok: true });
    expect(await updateSelfie(deps(d), USER.buyer, { id: a.id, isDefault: false as unknown as true })).toEqual({ ok: false, code: 'invalid' });
    expect(await updateSelfie(deps(d), USER.buyer, { id: a.id })).toEqual({ ok: false, code: 'invalid' });
    expect(await defaults()).toEqual([b.id]);
    await expect(h.sql.query('update identity_selfies set is_default=true where id=$1', [a.id])).rejects.toThrow(/identity_selfie_default/);
    // A replaced or deleted row can never claim to be the default.
    await expect(h.sql.query('update identity_selfies set is_default=true, deleted_at=now() where id=$1', [a.id])).rejects.toThrow(/identity_selfies_default_active/);
  });

  it('labels are the owner’s short note: trimmed, at most 40 characters, cleared with an empty value', async () => {
    const a = await save('#d6d6d6');
    expect(normalizeSelfieLabel('  안경  ')).toEqual({ ok: true, label: '안경' });
    expect(normalizeSelfieLabel('긴\n머리\u0007')).toEqual({ ok: true, label: '긴 머리' });
    expect(normalizeSelfieLabel('')).toEqual({ ok: true, label: null });
    expect(normalizeSelfieLabel(null)).toEqual({ ok: true, label: null });
    expect(normalizeSelfieLabel('가'.repeat(40))).toEqual({ ok: true, label: '가'.repeat(40) });
    expect(normalizeSelfieLabel('가'.repeat(41))).toEqual({ ok: false });
    expect(normalizeSelfieLabel(42)).toEqual({ ok: false });
    expect(await updateSelfie(deps(), USER.buyer, { id: a.id, label: '  안경  ' })).toEqual({ ok: true });
    expect((await currentSelfie(h.sql, USER.buyer))?.label).toBe('안경');
    expect(await updateSelfie(deps(), USER.buyer, { id: a.id, label: 'x'.repeat(41) })).toEqual({ ok: false, code: 'invalid' });
    expect(await updateSelfie(deps(), USER.buyer, { id: a.id, label: '' })).toEqual({ ok: true });
    expect((await currentSelfie(h.sql, USER.buyer))?.label).toBeNull();
    await expect(h.sql.query('update identity_selfies set label=$2 where id=$1', [a.id, 'x'.repeat(41)])).rejects.toThrow(/check/);
  });

  it('deleting is soft: the default passes to the newest active photo, the last one may go, the file stays', async () => {
    const d = { limit: 3 };
    const a = await save('#d6d6d6', { ...d, now: at('2026-10-22T09:00:00Z') });
    const b = await save('#a0a0a0', { ...d, now: at('2026-10-22T09:05:00Z') });
    const c = await save('#707070', { ...d, now: at('2026-10-22T09:10:00Z') });
    expect(await deleteSelfie(deps({ ...d, now: at('2026-10-22T11:00:00Z') }), USER.buyer, a.id)).toEqual({ ok: true });
    expect(await defaults()).toEqual([c.id]);
    expect((await h.sql.query('select deleted_at, is_default from identity_selfies where id=$1', [a.id])).rows[0]).toEqual({ deleted_at: at('2026-10-22T11:00:00Z'), is_default: false });
    expect(objects.has(selfieKey(a.id))).toBe(true);
    // Gone for the owner too: no image, no order, no second delete, no default.
    expect(await ownSelfie(h.sql, USER.buyer, a.id)).toBeNull();
    expect(await savedSelfiePhoto(h.sql, store(), USER.buyer, a.id)).toBeNull();
    expect(await deleteSelfie(deps(d), USER.buyer, a.id)).toEqual({ ok: false, code: 'not_found' });
    expect(await updateSelfie(deps(d), USER.buyer, { id: a.id, isDefault: true })).toEqual({ ok: false, code: 'not_found' });
    // A freed slot takes a new photo.
    const e = await save('#303030', { ...d, now: at('2026-10-22T11:05:00Z') });
    expect(await defaults()).toEqual([c.id]);
    for (const id of [b.id, c.id, e.id]) expect(await deleteSelfie(deps(d), USER.buyer, id)).toEqual({ ok: true });
    expect(await currentSelfie(h.sql, USER.buyer)).toBeNull();
    expect(await selfieLibrary(h.sql, USER.buyer, 3)).toEqual({ limit: 3, defaultId: null, items: [] });
    // After the last one is gone the next upload is the default again.
    const f = await save('#101010', { ...d, now: at('2026-10-22T12:00:00Z') });
    expect(await defaults()).toEqual([f.id]);
  });

  it('a lowered limit never strands photos: they stay usable, replaceable and deletable, but no new one fits', async () => {
    const a = await save('#d6d6d6', { limit: 3 });
    const b = await save('#a0a0a0', { limit: 3 });
    expect(await saveSelfie(deps({ limit: 1 }), USER.buyer, { bytes: await picture('#404040'), mime: 'image/png', consent: true })).toEqual({ ok: false, code: 'limit_reached' });
    expect(await savedSelfiePhoto(h.sql, store(), USER.buyer, b.id)).not.toBeNull();
    const c = await save('#404040', { limit: 1 }, b.id);
    expect((await selfieLibrary(h.sql, USER.buyer, 1)).items.map(item => item.id)).toEqual([a.id, c.id]);
  });

  it('answers only for the owner: a stranger, a garbage id or an unknown id are simply not found', async () => {
    const a = await save('#d6d6d6');
    expect(await savedSelfiePhoto(h.sql, store(), USER.other, a.id)).toBeNull();
    expect(await ownSelfie(h.sql, USER.other, a.id)).toBeNull();
    expect(await ownSelfie(h.sql, USER.buyer, 'not-a-uuid')).toBeNull();
    expect(await savedSelfiePhoto(h.sql, store(), USER.buyer, '00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await updateSelfie(deps(), USER.other, { id: a.id, label: 'mine' })).toEqual({ ok: false, code: 'not_found' });
    expect(await deleteSelfie(deps(), USER.other, a.id)).toEqual({ ok: false, code: 'not_found' });
    expect(await deleteSelfie(deps(), USER.buyer, 'not-a-uuid')).toEqual({ ok: false, code: 'not_found' });
    expect(await updateSelfie(deps(), null, { id: a.id, label: 'x' })).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await deleteSelfie(deps(), null, a.id)).toEqual({ ok: false, code: 'sign_in_required' });
    // Replacing someone else's photo, a deleted one or a garbage id is refused before any byte is written.
    const before = objects.size;
    expect(await saveSelfie(deps(), USER.other, { bytes: await picture('#a0a0a0'), mime: 'image/png', consent: true, replaceId: a.id })).toEqual({ ok: false, code: 'not_found' });
    expect(await saveSelfie(deps(), USER.buyer, { bytes: await picture('#a0a0a0'), mime: 'image/png', consent: true, replaceId: 'nope' })).toEqual({ ok: false, code: 'not_found' });
    expect(objects.size).toBe(before);
    expect(await currentSelfie(h.sql, USER.other)).toBeNull();
    expect((await currentSelfie(h.sql, USER.buyer))?.label).toBeNull();
  });

  it('an order may use ANY active photo of its owner and stamps last_used_at', async () => {
    const d = { limit: 3 };
    const a = await save('#d6d6d6', d);
    const b = await save('#a0a0a0', d);
    const photo = await savedSelfiePhoto(h.sql, store(), USER.buyer, b.id, at('2026-10-22T13:00:00Z'));
    expect(photo).toEqual({ bytes: objects.get(selfieKey(b.id)), mime: 'image/png' });
    expect((await ownSelfie(h.sql, USER.buyer, b.id))?.last_used_at).toEqual(at('2026-10-22T13:00:00Z'));
    expect((await ownSelfie(h.sql, USER.buyer, a.id))?.last_used_at).toBeNull();
    // The default stays the default; the grid shows the last-used photo right after it.
    expect((await currentSelfie(h.sql, USER.buyer))?.id).toBe(a.id);
    const c = await save('#707070', { ...d, now: at('2026-10-22T14:00:00Z') });
    expect((await selfieLibrary(h.sql, USER.buyer, 3)).items.map(item => [item.id, item.lastUsedAt])).toEqual([[a.id, null], [b.id, '2026-10-22T13:00:00.000Z'], [c.id, null]]);
    // A stranger's read stamps nothing.
    await savedSelfiePhoto(h.sql, store(), USER.other, a.id);
    expect((await ownSelfie(h.sql, USER.buyer, a.id))?.last_used_at).toBeNull();
  });

  it('bounds saves per day — deletions and replacements count — without touching the default', async () => {
    let current = await save('#000000');
    for (let i = 1; i < SELFIE_DAILY_SAVES; i++) current = await save(`#${(0x101010 + i * 0x010101).toString(16).padStart(6, '0')}`, {}, current.id);
    await deleteSelfie(deps(), USER.buyer, current.id);
    expect(await saveSelfie(deps(), USER.buyer, { bytes: await picture('#ffffff'), mime: 'image/png', consent: true })).toEqual({ ok: false, code: 'rate_limited' });
    expect(await currentSelfie(h.sql, USER.buyer)).toBeNull();
    // A day later the person may upload again.
    expect((await saveSelfie(deps({ now: at('2026-10-23T09:00:01Z') }), USER.buyer, { bytes: await picture('#ffffff'), mime: 'image/png', consent: true })).ok).toBe(true);
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
